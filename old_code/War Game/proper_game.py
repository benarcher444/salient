# -*- coding: utf-8 -*-
"""
Created on Fri Oct 29 17:31:04 2021

@author: Ben Archer
"""
import pygame
import numpy as np
import random
import threading
import socket
import copy
from math import ceil, sin, cos, pi, atan
from grid import Grid
from game import Main_Game
from unit import Unit
from specific_units import Engineer
from player import Player
from hit_marker import Hit_Marker

background_colour = "black"
text_colour = "white"
box_colour = "white"
hover_colour = "gray"
selected_colour = "black"
wall_width = 1/3

colours = {"black": (000, 000, 000),
           "white": (255, 255, 255),
           "gray":  (100, 100, 100),
           "grass green": (000, 100, 000),
           "dark red": (150, 000, 000),
           "dark blue": (000, 000, 100),
           "dark green": (17, 59, 8),
           "dark yellow": (204, 176, 9),
           "dark gray": (5, 5, 5),
           "water": (0,123,186),
           "purple": (100, 000, 100),
           "gold": (212, 175, 55),
           "brown": (155, 103, 60),
           "red": (255, 000, 000),
           "green": (000, 255, 000),
           "blue": (000, 000, 255),
           "yellow": (255, 255, 000)}

map_colours = {"red base": "dark red",
               "blue base": "dark blue",
               "green base": "dark green",
               "yellow base": "dark yellow",
               "grass":     "grass green",
               "building":  "gray",
               "rock": "dark gray",
               "water": "water",
               "command": "purple",
               "income": "gold",
               "wall": "dark gray",
               "barrier": "brown"}

pygame.init()
pygame.font.init()

font_size = []

for i in range(150,1,-1):
    myfont = pygame.font.SysFont(None,i)
    font_size.append(myfont)
    
height = 600
width = 800

class Game(Main_Game):
    def __init__(self, player, map_choice, player_name, network, width, height, screen):
        self.player = Player(player, player_name)
        self.map = copy.deepcopy(map_choice)
        self.width = width
        self.height = height
        self.screen = screen
        self.outline = 2
        self.setup = False
        self.selected = None
        self.redraw = []
        self.bases = self.map.bases[self.player.player.lower()].copy()
        self.selected_tile = None
        self.selected_unit = None
        self.hovered_unit = None
        self.units = []
        self.holding = [False for i in range(4)]
        self.keys = [pygame.K_w, pygame.K_a, pygame.K_s, pygame.K_d]
        self.checking = True
        self.network = network
        self.wait = False
        self.tick = 0
        self.hit_markers = []
        self.accuracy = 0
        
        self.input = threading.Thread(target = self.check_server)
        self.input.daemon = True
        self.input.start()
        
        self.different_units = {"Unit" : (Unit, Unit(-1, 0, 0, 0, 0, 0)),
                                "Engineer" : (Engineer, Engineer(-1, 0, 0, 0, 0, 0))}
        
        self.title_names = [player_name, "Turn", "Gold", "Income"]
        self.title_names.extend(list(self.different_units.keys()))
        self.titles = self.make_dicts(self.title_names)
        
        self.titles[player_name].fill_colour = "dark " + player.lower()
        
        for i, item in enumerate(["Turn", "Gold", "Income"]):
            self.titles[item].x_center = 0
        
        self.button_names = ["End Turn"]
        self.button_names.extend(list(self.different_units.keys()))
        self.buttons = self.make_dicts(self.button_names)
        
        self.buttons["End Turn"].fill_colour = "dark " + player.lower()
        
        for i, (key, (func, unit)) in enumerate(self.different_units.items()):
            self.buttons[key].draw = False
            self.buttons[key].fill_colour = unit.colour
            
        self.info_names = ["Name", "Energy"]
        self.info_boxes = self.make_dicts(self.info_names)
        
        for box in self.info_boxes.values():
            box.x_center = 0
    
    def run(self):
        if self.setup == False:
            self.run_setup()
            
        if self.grid.draw_map == True:
            self.draw_map()
        elif self.grid.draw_units == True:
            self.draw_units()
        
        self.x, self.y = pygame.mouse.get_pos()
        self.in_buttons = dict(zip(self.button_names, [self.inside_box(box.size) for box in self.buttons.values()]))
        self.in_units = [unit.in_unit(self.x, self.y) for unit in self.units]
        
        for name in self.redraw:
            if self.buttons[name].draw == True:
                self.draw_box(self.buttons[name])
            
        self.redraw = []
        
        for name in [name for (name, value) in self.in_buttons.items() if value == True]:
            if self.buttons[name].draw == True:
                self.draw_box_size(self.buttons[name].size, "gray", self.outline)
                self.redraw.append(name)
        
        if (self.tick % 60) == 0:
            pass
        
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.checking = False
                self.network.send(["finish"])
                return "menu"
            if self.wait == False:
                if event.type == pygame.MOUSEBUTTONDOWN:
                    if event.button == 1:
                        if self.inside_box(self.grid.sensitive_box):
                            if True in self.in_units:
                                selected_unit = self.in_units.index(True)
                                if self.units[selected_unit].team == self.player.player:
                                    if self.selected_unit == selected_unit:
                                        self.selected_unit = None
                                    else:
                                        self.selected_unit = selected_unit
                                    self.grid.draw_map = True
                                    self.draw_info()
                                else:
                                    if self.selected_unit != None:
                                        attacked_unit = self.in_units.index(True)
                                        attacked = self.attack_unit(self.units[attacked_unit], self.units[self.selected_unit])
                                        if attacked:
                                            self.grid.draw_units = True
                                            self.draw_info()
                            else:
                                x,y = self.which_tile()
                                if [x, y] in self.bases:
                                    if self.selected_tile == [x, y]:
                                        self.selected_tile = None
                                    else:
                                        self.selected_tile = [x, y]
                                    self.which_available()
                                    self.grid.draw_map = True
                        else:
                            if True in self.in_buttons.values():
                                if self.in_buttons["End Turn"] == True:
                                    self.end_turn()
                                elif self.selected_tile != None:
                                    for unit_type, (unit_function, unit_example) in self.different_units.items(): 
                                        if self.in_buttons[unit_type] == True:
                                            if self.no_units_in_square(unit_example.radius) == True:
                                                new_unit = self.new_unit(unit_function, unit_example)
                                                if new_unit:
                                                    self.grid.draw_units = True
                                            
                    elif event.button == 3:
                        if self.selected_unit != None:
                            self.units[self.selected_unit].redirect(self.x, self.y)
                            self.which_visible(self.units[self.selected_unit])
                            self.grid.draw_units = True
                            self.draw_info()
                    else:
                        self.zoom_grid(event.button)
                        
                elif event.type == pygame.KEYDOWN:
                    if self.selected_unit != None:
                        for i, key in enumerate(self.keys):
                            if event.key == key:
                                self.holding[i] = True
                                
                elif event.type == pygame.KEYUP:
                    for i, key in enumerate(self.keys):
                            if event.key == key:
                                self.holding[i] = False
        
        if self.selected_unit != None:
            if True in self.holding:
                moved = self.units[self.selected_unit].move(self.holding)
                if moved:
                    self.grid.draw_map = True
                    self.which_visible(self.units[self.selected_unit])
                    self.draw_info()

        if True in self.in_units:
            hovered_unit = self.in_units.index(True)
            if hovered_unit != self.selected_unit:
                if self.selected_unit != None:
                    if self.units[hovered_unit].team != self.player.player:
                        self.draw_hovered_unit(self.units[hovered_unit])
                        
                if self.hovered_unit != hovered_unit:
                    self.hovered_unit = hovered_unit
                    self.draw_info()
            else:
                if self.hovered_unit != None:
                    self.hovered_unit = None
                    self.draw_info()
                    self.grid.draw_units = True
        else:
            if self.hovered_unit != None:
                self.hovered_unit = None
                self.draw_info()
                self.grid.draw_units = True
            
        self.scroll_grid()
        
        new_hit_markers = []
        for hit_marker in self.hit_markers:
            draw = hit_marker.calculate_width(self.tick)
            if draw == True:
                self.draw_hit_marker(hit_marker)
                new_hit_markers.append(hit_marker)
            else:
                self.grid.draw_map = True
        
        self.hit_markers = new_hit_markers
        
        pygame.display.flip()
        
        self.tick += 1
        
        return "play game"
        
    def run_setup(self):
        indent = 0
        start = self.height - indent
        spare = self.width - start
        y_step = self.height/15
        
        self.top_corner = np.array([indent, indent])
        self.bottom_corner = np.array([self.height - indent, self.height - indent])
        
        self.grid = Grid(self.map, self.top_corner, self.bottom_corner)
        
        self.titles[self.player.name].size = [self.height - indent - 1, indent, self.width - self.height + indent + 1, y_step]
        
        for i, item in enumerate(["Turn", "Gold", "Income"]):
            self.titles[item].size = [self.height + spare/10, y_step*(1.2 + i*0.6), spare*6/10, y_step*0.5]
        
        self.titles["Unit"].size = [start + (spare - y_step*2)/3 - spare/10, y_step*3.5, y_step + spare/5, y_step*0.5]
        self.titles["Engineer"].size = [start + 2*(spare - y_step*2)/3 - spare/10 + y_step, y_step*3.5, y_step + spare/5, y_step*0.5]
        
        self.buttons["Unit"].size = [start + (spare - y_step*2)/3, y_step*4, y_step, y_step]
        self.buttons["Engineer"].size = [start + 2*(spare - y_step*2)/3 + y_step, y_step*4, y_step, y_step]
        self.buttons["End Turn"].size = [start, self.height - y_step, spare, y_step]
        
        start_x = self.height
        start_y = 3*self.height/4
        width = self.width - start_x
        height = self.height - start_y - self.buttons["End Turn"].size[3]
        x_indent = width/20
        y_indent = height/10
        
        self.info_boxes["Name"].size = [start_x + x_indent, start_y + 2*y_indent, width - 2*x_indent, 3*y_indent]
        self.info_boxes["Energy"].size = [start_x + x_indent, start_y + 4*y_indent, width - 2*x_indent, 3*y_indent]
        
        self.screen.fill(colours[background_colour])
        
        self.draw_side()
        self.draw_map()
        
        self.grid.draw_map = True
        self.setup = True
        
    def draw_side(self):
        indent = 0
        start = self.height - indent
        spare = self.width - start
        
        self.titles["Turn"].text = "Turn:     " + str(self.player.turn)
        self.titles["Gold"].text = "Gold:     " + str(self.player.gold)
        self.titles["Income"].text = "Income:     " + str(self.player.income + self.player.extra_income)
        
        if self.wait == True:
            self.buttons["End Turn"].text = "Waiting"
        else:
            self.buttons["End Turn"].text = "End Turn"
        
        self.draw_box_size([start, 0, spare, self.height], "black", 0)
        
        for i, box in enumerate(list(self.titles.values())):
            if box.draw == True:
                if box.text == self.player.name:
                    self.draw_box_fill(box, outline = False)
                self.resize_font(box)
                self.write(box)
                
        for i, box in enumerate(list(self.buttons.values())):
            if (box.text == "End Turn") | (box.text == "Waiting"):
                if box.draw == True:
                    self.draw_box_fill(box, outline = True)
                    self.resize_font(box)
                    self.write(box)
            else:
                self.draw_unit_boxes(box)
                
        self.draw_info()
                
    def draw_info(self):
        start_x = self.height
        start_y = 3*self.height/4
        width = self.width - start_x
        height = self.height - start_y - self.buttons["End Turn"].size[3]
        x_indent = width/20
        y_indent = height/10
        
        self.draw_box_size([start_x, start_y, width, height], "black", 0)
        
        if (self.selected_unit != None) | (self.hovered_unit != None):
            if (self.selected_unit != None) & (self.hovered_unit != None) & (self.selected_unit != self.hovered_unit):
                self.calculate_accuracy(self.units[self.hovered_unit], self.units[self.selected_unit])
                unit = self.units[self.hovered_unit]
                self.info_boxes["Energy"].text = "Accuracy : " + str(int(self.accuracy*100))
            elif (self.selected_unit != None) & (self.hovered_unit != None):
                unit = self.units[self.selected_unit]
                self.info_boxes["Energy"].text = "Energy : " + str(unit.energy)
            elif (self.selected_unit != None) & (self.hovered_unit == None):
                unit = self.units[self.selected_unit]
                self.info_boxes["Energy"].text = "Energy : " + str(unit.energy)
            elif (self.selected_unit == None) & (self.hovered_unit != None):
                unit = self.units[self.hovered_unit]
                self.info_boxes["Energy"].text = "Energy : " + str(unit.energy)
            
                
            self.draw_box_size([start_x + x_indent, start_y + 7*y_indent, width - 2*x_indent, y_indent], "red", 0)
            self.draw_box_size([start_x + x_indent, start_y + 7*y_indent, (width - 2*x_indent)*unit.health/unit.max_health, y_indent], "green", 0)
            
            self.info_boxes["Name"].text = unit.team + " Unit " + str(unit.id) + " : " + unit.type
            
            min_font = 0
            for box in self.info_boxes.values():
                min_font = max(min_font, self.resize_font(box, out = True))
            
            for box in self.info_boxes.values():
                self.write_same(box, font_size[min_font], x_center = 0)
    
    def draw_hit_marker(self, hit_marker):
        pygame.draw.line(self.screen, colours[hit_marker.colour], hit_marker.start, hit_marker.end, hit_marker.width)
    
    def no_units_in_square(self, radius):
        for unit in self.units:
            if unit.in_square(self.selected_tile[0], self.selected_tile[1], radius):
                return False
        return True
    
    def draw_unit_boxes(self, box):
        pygame.draw.rect(self.screen, box.fill_colour, box.size)
        if box.draw == True:
            pygame.draw.rect(self.screen, colours["white"], box.size, box.outline)
    
    def draw_selected(self):
        if (int(self.grid.indent_x) <= self.selected_tile[0] <  int(self.grid.indent_x) + self.grid.zoom) & (int(self.grid.indent_y) <= self.selected_tile[1] < int(self.grid.indent_y) + self.grid.zoom):
            tile_size = self.grid.tile_size
            self.draw_box_size([self.grid.start_x + (self.selected_tile[0] - int(self.grid.indent_x))*(tile_size + 1), self.grid.start_y + (self.selected_tile[1] - int(self.grid.indent_y))*(tile_size + 1), tile_size, tile_size], self.player.player.lower(), outline = 3)
    
    def draw_units(self):
        redraw = False
        for i, unit in enumerate(self.units):
            if unit.visible:
                unit.position()
                if redraw == False:
                    if (int(self.grid.indent_x) <= unit.x < int(self.grid.indent_x) + self.grid.zoom) & (int(self.grid.indent_y) <= unit.y < int(self.grid.indent_y) + self.grid.zoom):
                        redraw = unit.off_edge()
                if i == self.selected_unit:
                    self.draw_unit(unit, selected = True)
                else:
                    self.draw_unit(unit)
        if redraw == True:
            self.draw_side()
        self.grid.draw_units = False
            
    def draw_unit(self, unit, selected = False):
        if (int(self.grid.indent_x) <= unit.x < int(self.grid.indent_x) + self.grid.zoom) & (int(self.grid.indent_y) <= unit.y < int(self.grid.indent_y) + self.grid.zoom):
            pygame.draw.circle(self.screen, colours["black"], (int(unit.x_pos), int(unit.y_pos)), int(unit.radius*self.grid.tile_size))
            pygame.draw.polygon(self.screen, unit.colour, [(int(unit.x_pos), int(unit.y_pos)), (int(unit.x_pos) + int((unit.radius*self.grid.tile_size-1)*cos(unit.orientation - .25)), int(unit.y_pos) + int((unit.radius*self.grid.tile_size-1)*sin(unit.orientation - .25) - 1)), (int(unit.x_pos) + int((unit.radius*self.grid.tile_size-1)*cos(unit.orientation + .25)), int(unit.y_pos) + int((unit.radius*self.grid.tile_size-1)*sin(unit.orientation + .25) - 1))])
            pygame.draw.polygon(self.screen, colours["white"], [(int(unit.x_pos), int(unit.y_pos)), (int(unit.x_pos) + int((unit.radius*self.grid.tile_size-1)*cos(unit.orientation - .1)), int(unit.y_pos) + int((unit.radius*self.grid.tile_size-1)*sin(unit.orientation - .1) - 1)), (int(unit.x_pos) + int((unit.radius*self.grid.tile_size-1)*cos(unit.orientation + .1)), int(unit.y_pos) + int((unit.radius*self.grid.tile_size-1)*sin(unit.orientation + .1) - 1))])
            pygame.draw.circle(self.screen, unit.edge_center, (int(unit.x_pos), int(unit.y_pos)), ceil(unit.radius*self.grid.tile_size/5) + ceil(self.grid.tile_size/20))
            pygame.draw.circle(self.screen, unit.center, (int(unit.x_pos), int(unit.y_pos)), ceil(unit.radius*self.grid.tile_size/5))
            if selected == False:
                pygame.draw.circle(self.screen, colours[unit.team.lower()], (int(unit.x_pos), int(unit.y_pos)), int(unit.radius*self.grid.tile_size), ceil(self.grid.tile_size/20))
            else:
                pygame.draw.circle(self.screen, colours["white"], (int(unit.x_pos), int(unit.y_pos)), int(unit.radius*self.grid.tile_size), ceil(self.grid.tile_size/20))
        
    def unit_tile(self, unit):
        x_pos = unit.x - self.grid.start_x
        y_pos = unit.y - self.grid.start_y
        step = self.grid.size/self.grid.zoom
        x = int(x_pos//step + int(self.grid.indent_x))
        y = int(y_pos//step + int(self.grid.indent_y))
        return x, y
    
    def draw_map(self):
        self.draw_grid()
        if self.selected_tile != None:
            self.draw_selected()
        self.draw_units()
        self.grid.draw_map = False
        self.grid.draw_units = False
        
    def draw_selected_squares(self, squares, colour):
        for x, y in squares:
            tile_size = self.grid.tile_size
            self.draw_box_size([self.grid.start_x + (x - int(self.grid.indent_x))*(tile_size + 1) - 1, self.grid.start_y + (y - int(self.grid.indent_y))*(tile_size + 1) - 1, tile_size + 2, tile_size + 2], "black", outline = 0)
            self.draw_box_size([self.grid.start_x + (x - int(self.grid.indent_x))*(tile_size + 1), self.grid.start_y + (y - int(self.grid.indent_y))*(tile_size + 1), tile_size, tile_size], colour, outline = 0)
            if self.grid.map.map[x][y].walls == True:
                self.draw_walls(tile_size, x, y)
                
    def end_turn(self):
        self.wait = True
        self.network.send(["units", self.units])
        self.selected = None
        self.selected_tile = None
        self.selected_unit = None
        self.which_available()
        self.draw_side()
        
    def draw_hovered_unit(self, unit):
        colour = [int(255*(1 - self.accuracy)), int(255*self.accuracy), 000]
        pygame.draw.circle(self.screen, colour, (int(unit.x_pos), int(unit.y_pos)), int(unit.radius*self.grid.tile_size))
    
    def calculate_dist_orien(self, unit, selected_unit):
        x_dist = unit.x - selected_unit.x
        y_dist = unit.y - selected_unit.y
        dist = (x_dist**2 + y_dist**2)**0.5
        
        if x_dist == 0:
            if y_dist > 0:
                orientation = pi/2
            else:
                orientation = -pi/2
            gradient = 100000
        else:
            if x_dist > 0:
                orientation = atan(y_dist/x_dist)
            else:
                orientation = atan(y_dist/x_dist) + pi
            gradient = y_dist/x_dist
            
        return dist, orientation, gradient
    
    def calculate_accuracy(self, unit, selected_unit):
        
        dist, orientation, gradient = self.calculate_dist_orien(unit, selected_unit)
                
        wall_blocking = False
        unit_blocking = False
        block_blocking = False
        
        for other_unit in self.units:
            if (other_unit.id != unit.id) & (other_unit.team != selected_unit.team):
                x_range = sorted([selected_unit.x, unit.x])
                y_range = sorted([selected_unit.y, unit.y])
                if (x_range[0] - other_unit.radius < other_unit.x < x_range[1] + other_unit.radius) & (y_range[0] - other_unit.radius < other_unit.y < y_range[1] + other_unit.radius):
                    C = (selected_unit.y - gradient*selected_unit.x)
                    if ((C*gradient - gradient*other_unit.y - other_unit.x)**2 - (gradient**2 + 1)*(C**2 + other_unit.y**2 + other_unit.x**2 - 2*other_unit.y*C - (3*other_unit.radius/4)**2)) > 0:
                        unit_blocking = True
                        break
        
        if unit_blocking != True:
            squares = []
            x_range = sorted([unit.x, selected_unit.x])
            y_range = sorted([unit.y, selected_unit.y])
            c = unit.y - gradient*unit.x

            to_check = list(range(int(x_range[0]), int(x_range[1]) + 1))

            for x in to_check:
                y = int(gradient*x + c)
                y_star = int(gradient*(x + 1) + c)
                y_step_range = sorted([y, y_star])
                y_values = list(range(y_step_range[0], y_step_range[1] + 1))
                for yi in y_values:
                    if int(y_range[0]) <= yi <= y_range[1]:
                        squares.append([x, yi])
            
            sign_func = lambda x: True if x > 0 else False
            line_func = lambda x, y: sign_func(y - gradient*x - c)
            
            barrier_effect_modifier = 1
            
            for [x, y] in squares:
                if self.grid.map.map[x][y].walls | (self.grid.map.map[x][y].type == "rock"):
                    wall_blocking, barrier_effect = self.check_wall_cross(x, y, x_range, y_range, line_func, selected_unit)
                    block_blocking = self.check_block_cross(x, y, line_func)
                    if wall_blocking | block_blocking:
                        break
                    else:
                        barrier_effect_modifier = barrier_effect_modifier*barrier_effect
        
        if (not unit_blocking) & (not wall_blocking) & (not block_blocking):
            self.accuracy = selected_unit.accuracy(dist, orientation)*barrier_effect_modifier
        else:
            self.accuracy = 0
        
    def calculate_damage(self, unit, selected_unit):
        dist, orientation, gradient = self.calculate_dist_orien(unit, selected_unit)
        damage = selected_unit.calculate_damage(dist, orientation, unit.orientation)
        return damage
    
    def attack_unit(self, attacked_unit, attacking_unit):
        if attacking_unit.move_type != "moved":
            damage = self.calculate_damage(attacked_unit, attacking_unit)
            if self.accuracy > 0:
                if attacking_unit.energy != 0:
                    attacking_unit.move_type = "attacked"
                    u = random.random()
                    if u <= self.accuracy:
                        crit_chance = attacking_unit.crit()
                        if u <= crit_chance:
                            crit = True
                            damage = damage*2
                        else:
                            crit = False
                        attacked_unit.health = max(0, attacked_unit.health - damage)
                        attacked_unit.damage_taken += damage
                        attacked_unit.calculate_colour()
                        attacking_unit.energy = 0
                        attacking_unit.calculate_edge_colour()
                        if crit:
                            shot_type = "crit"
                        else:
                            shot_type = "hit"
                    else:
                        shot_type = "miss"
                        
                    self.hit_markers.append(Hit_Marker(attacking_unit.x_pos, attacking_unit.y_pos, attacked_unit.x_pos, attacked_unit.y_pos, shot_type, self.tick))
                    return True
                
        return False
        
    def new_unit(self, unit_function, unit_example):
        if self.player.gold >= unit_example.cost:
            unit = unit_function(self.player.unit_id, self.player.player, self.selected_tile[0], self.selected_tile[1], self.grid, self.units)
            self.units.append(unit)
            self.player.gold -= unit.cost
            self.player.unit_id += 1
            self.which_available()
            return True
        return False
            
    def which_available(self):
        for unit_name, (unit_function, unit_example) in self.different_units.items():
            self.buttons[unit_name].draw = True
            if self.selected_tile == None:
                self.buttons[unit_name].draw = False
            elif self.player.gold < unit_example.cost:
                self.buttons[unit_name].draw = False
        self.draw_side()
        
    def draw_grid_black(self, x, y):
        tile_size = self.grid.tile_size
        self.draw_box_size([self.grid.start_x + (x - int(self.grid.indent_x))*(tile_size + 1) - 1, self.grid.start_y + (y - int(self.grid.indent_y))*(tile_size + 1) - 1, tile_size + 2, tile_size + 2], "black", outline = 0)
        
    def check_block_cross(self, x, y, line_func):
        if self.grid.map.map[x][y].type == "rock":
            points = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]
            if not self.all_same_side(points, line_func):
                return True
        return False
        
    def check_wall_cross(self, x, y, x_range, y_range, line_func, selected_unit):
        barrier_effect = 1
        if self.grid.map.map[x][y].walls:
            if self.grid.map.map[x][y].top != None:
                points = [[x, y], [x + 1, y], [x, y + wall_width], [x + 1, y + wall_width]]
                if y + wall_width > y_range[0]:
                    if not self.all_same_side(points, line_func):
                        if self.grid.map.map[x][y].top == "wall":
                            return True, 0
                        elif self.grid.map.map[x][y].top == "barrier":
                            barrier_effect = barrier_effect*self.calculate_barrier_effect(points, selected_unit)
                            
            if self.grid.map.map[x][y].left != None:
                points = [[x, y], [x, y + 1], [x + wall_width, y], [x + wall_width, y + 1]]
                if x + wall_width > x_range[0]:
                    if not self.all_same_side(points, line_func):
                        if self.grid.map.map[x][y].left == "wall":
                            return True, 0
                        elif self.grid.map.map[x][y].left == "barrier":
                            barrier_effect = barrier_effect*self.calculate_barrier_effect(points, selected_unit)
                            
            if self.grid.map.map[x][y].bottom != None:
                points = [[x, y + 1], [x + 1, y + 1], [x, y + 1 - wall_width], [x + 1, y + 1 - wall_width]]
                if y + 1 - wall_width < y_range[1]:
                    if not self.all_same_side(points, line_func):
                        if self.grid.map.map[x][y].bottom == "wall":
                            return True, 0
                        elif self.grid.map.map[x][y].bottom == "barrier":
                            barrier_effect = barrier_effect*self.calculate_barrier_effect(points, selected_unit)
                            
            if self.grid.map.map[x][y].right != None:
                points = [[x + 1, y], [x + 1, y + 1], [x + 1 - wall_width, y], [x + 1 - wall_width, y + 1]]
                if x + 1 - wall_width < x_range[1]:
                    if not self.all_same_side(points, line_func):
                        if self.grid.map.map[x][y].right == "wall":
                            return True, 0
                        elif self.grid.map.map[x][y].right == "barrier":
                            barrier_effect = barrier_effect*self.calculate_barrier_effect(points, selected_unit)
                            
        return False, barrier_effect
    
    def calculate_barrier_effect(self, points, unit):
        x, y = np.add(points[0], points[1])/2
        dist = ((x - unit.x)**2 + (y - unit.y)**2)**0.5
        return min(1, 0.7**(dist - 1))
            
    def all_same_side(self, points, line_func):
        which_side = np.array([line_func(x, y) for [x, y] in points])
        if all(which_side) or all(~which_side):
                return True
            
    def set_command_posts(self):
        self.bases = self.map.bases[self.player.player.lower()].copy()
        for command_post in self.map.command_posts:
            if command_post.team != None:
                self.map.map[command_post.x][command_post.y].type = command_post.team.lower() + " base"
                if command_post.team == self.player.player:
                    self.bases.append([command_post.x, command_post.y])
            else:
                self.map.map[command_post.x][command_post.y].type = "command"
                
    def calculate_extra_income(self):
        self.player.extra_income = 0
        for unit in self.units:
            if unit.type == "Engineer":
                if unit.team == self.player.player:
                    if len(unit.squares) == 1:
                        for income_square in self.map.income_squares:
                            if (list(unit.squares)[0][0] == income_square.x) & (list(unit.squares)[0][1] == income_square.y):
                                self.player.extra_income += income_square.value
                        
    def reset_units(self):
        for unit in self.units:
            unit.position()
            unit.grid = self.grid
            unit.units = self.units
            
            if unit.team != self.player.player:
                unit.visible = False
                
        for unit in self.units:
            if unit.team == self.player.player:
                self.which_visible(unit)
                
    def which_visible(self, unit):
        for other_unit in self.units:
            if other_unit.visible == True:
                continue
            else:
                other_unit.visible = self.calculate_visible(other_unit, unit)
    
    def calculate_visible(self, unit, selected_unit):
        dist, orientation, gradient = self.calculate_dist_orien(unit, selected_unit)
                
        wall_blocking = False
        block_blocking = False
        
        squares = []
        x_range = sorted([unit.x, selected_unit.x])
        y_range = sorted([unit.y, selected_unit.y])
        c = unit.y - gradient*unit.x

        to_check = list(range(int(x_range[0]), int(x_range[1]) + 1))

        for x in to_check:
            y = int(gradient*x + c)
            y_star = int(gradient*(x + 1) + c)
            y_step_range = sorted([y, y_star])
            y_values = list(range(y_step_range[0], y_step_range[1] + 1))
            for yi in y_values:
                if int(y_range[0]) <= yi <= y_range[1]:
                    squares.append([x, yi])
        
        sign_func = lambda x: True if x > 0 else False
        line_func = lambda x, y: sign_func(y - gradient*x - c)
        
        for [x, y] in squares:
            if self.grid.map.map[x][y].walls | (self.grid.map.map[x][y].type == "rock"):
                wall_blocking, barrier_effect = self.check_wall_cross(x, y, x_range, y_range, line_func, selected_unit)
                block_blocking = self.check_block_cross(x, y, line_func)
                if wall_blocking | block_blocking:
                    return False
        
        return True
        
    
    def check_server(self):
        self.network.client.settimeout(10)
        while self.checking:
            try:
                data = self.network.receive()
                
                if data == None:
                    self.checking = False
            
                elif data[0] == "ping":
                    self.network.send(["ping"])
                    
                elif data[0] == "units":
                    self.units = data[1].copy()
                    self.reset_units()
                    
                    self.map.command_posts = data[2].copy()
                    self.set_command_posts()
                    
                    self.calculate_extra_income()
                    self.player.end_turn()
                    self.grid.draw_map = True
                    self.wait = False
                    self.draw_side()
                
            except socket.error:
                print("Socket Error")
        