# -*- coding: utf-8 -*-
"""
Created on Tue Oct 26 21:20:17 2021

@author: Ben Archer
"""
import pygame
from game import Main_Game
from grid import Grid

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

class Edit_Map(Main_Game):
    def __init__(self, maps, width, height, screen):
        self.maps = maps
        self.width = width
        self.height = height
        self.screen = screen
        self.outline = 2
        self.setup = False
        self.redraw = []
        self.selected = None
        self.holding = False
        
        self.title_names = ["Title", "Red Base", "Blue Base", "Green Base", "Yellow Base",
                            "Grass", "Building", "Rock", "Water", "Command", "Income", "Wall", "Barrier"]
        self.titles = self.make_dicts(self.title_names)
        
        self.titles["Title"].x_center = 0
        
        self.button_names = ["Done", "Red Base", "Blue Base", "Green Base", "Yellow Base",
                            "Grass", "Building", "Rock", "Water", "Command", "Income", "Wall", "Barrier",
                            "+", "-"]
        self.buttons = self.make_dicts(self.button_names)
        
        for i, name in enumerate(["Done", "+", "-"]):
            self.buttons[name].y_center = [1, 0.5, 0.5][i]
    
    def run(self, map_choice):
        if self.setup == False:
            self.run_setup(map_choice)
            
        if self.grid.draw_map == True:
            self.draw_grid()
            self.grid.draw_map = False
        
        self.x, self.y = pygame.mouse.get_pos()
        self.in_buttons = dict(zip(self.button_names, [self.inside_box(box.size) for box in self.buttons.values()]))
        
        for name in self.redraw:
            self.draw_box(self.buttons[name])
            
        self.redraw = []
        
        for name in [name for (name, value) in self.in_buttons.items() if value == True]:
            self.draw_box_size(self.buttons[name].size, "gray", self.outline)
            self.redraw.append(name)
        
        if self.selected != None:
            self.draw_box_size(self.buttons[self.selected].size, "black", self.outline)
            
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return "game over"
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:
                    self.holding = True
                    if True in self.in_buttons.values():
                        if self.in_buttons["Done"]:
                            self.setup = False
                            self.grid.unnecessary_walls()
                            self.grid.map.count_bases()
                            self.save_maps()
                            return "map menu"
                        elif self.in_buttons["+"]:
                            self.grid.add()
                        elif self.in_buttons["-"]:
                            self.grid.delete()
                        elif True in list(self.in_buttons.values())[1:13]:
                            if self.selected != None:
                                self.redraw.append(self.selected)
                            new_selected = [name for (name, value) in self.in_buttons.items() if value == True][0]
                            if new_selected == self.selected:
                                self.selected = None
                            else:
                                self.selected = new_selected
                    elif self.inside_box(self.grid.sensitive_box):
                        if self.selected in ["Wall", "Barrier"]:
                            x,y = self.which_tile_side()
                            self.draw_grid_squares(x, y)

                else:
                    self.zoom_grid(event.button)
            elif event.type == pygame.MOUSEBUTTONUP:
                if event.button == 1:
                    self.holding = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_BACKSPACE:
                    self.maps[map_choice].title = self.maps[map_choice].title[:-1]
                else:
                    if len(self.maps[map_choice].title) < 30:
                        self.maps[map_choice].title += event.unicode
                self.draw_box_size(self.titles["Title"].size, background_colour, 0)
                self.titles["Title"].text = self.maps[map_choice].title
                self.write(self.titles["Title"])
                    
        if self.holding == True:
            if self.inside_box(self.grid.sensitive_box):
                if self.selected not in [None, "Wall", "Barrier"]:
                    x, y = self.which_tile()
                    self.grid.map.map[x][y].type = self.selected.lower()
                    self.add_walls(x, y)
                    self.draw_grid_squares(x, y)
        
        self.scroll_grid()
                    
        pygame.display.flip()
        
        return "edit map"
    
    def run_setup(self, map_choice):   
        start = self.width*3/4
        indent = self.height/30
        y_step = self.height/12.5
        extra_width = self.width/60
        
        self.top_corner = [indent, 2.25*indent]
        self.bottom_corner = [start, self.height - indent]
        
        self.map_choice = map_choice
        self.grid = Grid(self.maps[self.map_choice], self.top_corner, self.bottom_corner)
        
        left = self.width/4 - 2*y_step + self.grid.excess_x/2
        x_step = left/3
        
        self.titles["Title"].text = self.grid.map.title
        self.titles["Title"].size = [indent + self.grid.excess_x/2, indent, self.width/2 - self.grid.excess_x - indent, indent*1.25]
        
        for i, box in enumerate(list(self.titles.values())[1:]):
            if i % 2 == 0:
                box.size = [start + x_step - self.grid.excess_x/2 - extra_width, y_step/2 + y_step*i, y_step + extra_width*2, y_step/2]
            else:
                box.size = [start + x_step*2 + y_step - self.grid.excess_x/2 - extra_width, y_step/2 + y_step*2*(i//2), y_step + extra_width*2, y_step/2]
        
        self.buttons["+"].size = [indent*2 + self.width/2 - self.grid.excess_x/2, indent, indent, indent]
        self.buttons["-"].size = [self.width/2 - self.grid.excess_x/2, indent, indent, indent]
        self.buttons["Done"].size = [indent*4 + self.width/2 - self.grid.excess_x/2, indent, start - self.width/2  - 5*indent + self.grid.excess_x/2 - self.outline*2, indent]
        
        for i, box in enumerate(list(self.buttons.values())[1:11]):
            if i % 2 == 0:
                box.size = [start + x_step - self.grid.excess_x/2, y_step + y_step*i, y_step, y_step]
            else:
                box.size = [start + x_step*2 + y_step - self.grid.excess_x/2, y_step + y_step*2*(i//2), y_step, y_step]
        
        self.buttons["Wall"].size = [start + x_step - self.grid.excess_x/2, y_step*11.25, y_step, y_step/2]
        self.buttons["Barrier"].size = [start + x_step*2 + y_step - self.grid.excess_x/2, y_step*11.25, y_step, y_step/2]
        
        min_font = 0
        for box in list(self.titles.values())[1:]:
            min_font = max(min_font, self.resize_font(box, out = True))
        
        self.screen.fill(colours[background_colour])
        
        for name in ["Done", "+", "-"]:
            self.resize_font(self.buttons[name])
            self.draw_box(self.buttons[name])
            self.write(self.buttons[name])
        
        for box in list(self.buttons.values())[1:13]:
            box.fill_colour = map_colours[box.text.lower()]
            self.draw_box_fill(box)
        
        self.resize_font(self.titles["Title"])
        self.write(self.titles["Title"])
        
        for box in list(self.titles.values())[1:13]:
            self.write_same(box, font_size[min_font])
        
        self.setup = True  
        self.draw_map = True