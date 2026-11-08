# -*- coding: utf-8 -*-
"""
Created on Thu Sep 30 15:35:42 2021

@author: Ben Archer
"""

import pygame
import pickle
from box import Box
from grid import Grid
from math import ceil

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

class Main_Game():
    def __init__(self):
        pass
            
    def draw_box(self, box):
        pygame.draw.rect(self.screen, colours[box.colour], box.size, box.outline)
        
    def draw_box_size(self, size, colour, outline):
        pygame.draw.rect(self.screen, colours[colour], size, outline)
        
    def draw_box_fill(self, box, outline = True):
        self.draw_box_size(box.size, box.fill_colour, 0)
        if outline:
            self.draw_box(box)
    
    def write(self, box):
        rendered_text = box.font.render(box.text, 1, colours[box.font_colour])
        text_width, text_height = box.font.size(box.text)
        self.screen.blit(rendered_text, (int(box.size[0] + box.x_center*(box.size[2] - text_width)/2), int(box.size[1] + box.y_center*(box.size[3] - text_height))))
        
    def write_same(self, box, font, x_center = 1, y_center = 0.5):
        rendered_text = font.render(box.text, 1, colours[box.font_colour])
        text_width, text_height = font.size(box.text)
        self.screen.blit(rendered_text, (int(box.size[0] + x_center*(box.size[2] - text_width)/2), int(box.size[1] + y_center*(box.size[3] - text_height))))

    def resize_font(self, box, out = False):
        fit = False
        no = 0
        while fit == False:
            myfont = font_size[no]
            text_width, text_height = myfont.size(box.text)
            if (text_width > box.size[2] - 2*self.outline) | (text_height > box.size[3] - 2*self.outline):
                no +=1
            else:
                fit = True
        no = no + 5
        box.font_size = no
        box.font = font_size[no]
        if out == True:
            return no
    
    def inside_box(self, box):
        inside = True
        if (self.x < box[0]) | (self.x > box[0] + box[2]):
            inside = False
        elif (self.y < box[1]) | (self.y > box[1] + box[3]):
            inside = False
        return inside
        
    def save_maps(self):
        pickle.dump(self.maps, open('Maps.dat', 'wb'))
    
    def draw_grid(self):
        self.draw_box_size(self.grid.box, "black", 0)
        tile_size = self.grid.calculate_tile_size()
        for i in range(int(self.grid.indent_x), int(self.grid.indent_x) + self.grid.zoom):
            for j in range(int(self.grid.indent_y), int(self.grid.indent_y) + self.grid.zoom):
                self.draw_box_size([self.grid.start_x + (i - int(self.grid.indent_x))*(tile_size + self.grid.lines), self.grid.start_y + (j - int(self.grid.indent_y))*(tile_size + self.grid.lines), tile_size, tile_size], map_colours[self.grid.map.map[i][j].type], outline = 0)
                if self.grid.map.map[i][j].walls == True:
                    self.draw_walls(tile_size, i, j)
    
    def draw_grid_squares(self, x, y):
        tile_size = self.grid.tile_size
        self.draw_box_size([self.grid.start_x + (x - int(self.grid.indent_x))*(tile_size + 1) - 1, self.grid.start_y + (y - int(self.grid.indent_y))*(tile_size + 1) - 1, tile_size + 2, tile_size + 2], "black", outline = 0)
        self.draw_box_size([self.grid.start_x + (x - int(self.grid.indent_x))*(tile_size + 1), self.grid.start_y + (y - int(self.grid.indent_y))*(tile_size + 1), tile_size, tile_size], map_colours[self.grid.map.map[x][y].type], outline = 0)
        if self.grid.map.map[x][y].walls == True:
            self.draw_walls(tile_size, x, y)
        
    def draw_walls(self, tile_size, i, j):
        if self.grid.map.map[i][j].top != None:
            self.draw_box_size([self.grid.start_x + (i - int(self.grid.indent_x))*(tile_size + 1), self.grid.start_y + (j - int(self.grid.indent_y))*(tile_size + 1), tile_size, tile_size*wall_width], map_colours[self.grid.map.map[i][j].top], outline = 0)
        if self.grid.map.map[i][j].left != None:
            self.draw_box_size([self.grid.start_x + (i - int(self.grid.indent_x))*(tile_size + 1), self.grid.start_y + (j - int(self.grid.indent_y))*(tile_size + 1), tile_size*wall_width, tile_size], map_colours[self.grid.map.map[i][j].left], outline = 0)
        if self.grid.map.map[i][j].bottom != None:
            self.draw_box_size([self.grid.start_x + (i - int(self.grid.indent_x))*(tile_size + 1), self.grid.start_y + (j - int(self.grid.indent_y))*(tile_size + 1) + ceil(tile_size*(1 - wall_width)), tile_size, tile_size*wall_width], map_colours[self.grid.map.map[i][j].bottom], outline = 0)
        if self.grid.map.map[i][j].right != None:
            self.draw_box_size([self.grid.start_x + (i - int(self.grid.indent_x))*(tile_size + 1) + ceil(tile_size*(1 - wall_width)), self.grid.start_y + (j - int(self.grid.indent_y))*(tile_size + 1), tile_size*wall_width, tile_size], map_colours[self.grid.map.map[i][j].right], outline = 0)
        
    def scroll_grid(self):
        if self.inside_box(self.grid.box) == True:
            if (self.inside_box(self.grid.left) == True) & (self.grid.indent_x > 0.5):
                self.grid.move_left()
            elif (self.inside_box(self.grid.right) == True) & (self.grid.indent_x + self.grid.zoom < self.grid.map.size + 0.5):
                self.grid.move_right()
            if (self.inside_box(self.grid.top) == True) & (self.grid.indent_y > 0.5):
                self.grid.move_up()
            elif (self.inside_box(self.grid.bottom) == True) & (self.grid.indent_y + self.grid.zoom < self.grid.map.size + 0.5):
                self.grid.move_down()
                
    def zoom_grid(self, button):
        if self.inside_box(self.grid.box) == True:
            if button == 2:
                self.grid.zoom_reset()
            elif button == 4:
                self.grid.zoom_in()
            elif button == 5:
                self.grid.zoom_out()
                  
    def make_dicts(self, names):
        n = len(names)
        array_of_boxes = [Box(text = names[i], outline = self.outline) for i in range(n)]
        return dict(zip(names, array_of_boxes))
    
    def which_tile(self):
        x_pos = self.x - self.grid.start_x
        y_pos = self.y - self.grid.start_y
        step = self.grid.size/self.grid.zoom
        x = int(x_pos//step + int(self.grid.indent_x))
        y = int(y_pos//step + int(self.grid.indent_y))
        return x, y 
    
    def which_tile_side(self):
        x_pos = self.x - self.grid.start_x
        y_pos = self.y - self.grid.start_y
        step = self.grid.size/self.grid.zoom
        x_square = int(x_pos//step)
        y_square = int(y_pos//step)
        sp_x = (x_pos - x_square*step)/step
        sp_y = (y_pos - y_square*step)/step
        x = x_square + int(self.grid.indent_x)
        y = y_square + int(self.grid.indent_y)
        self.grid.map.map[x][y].walls = True
        if sp_x < sp_y:
            if -sp_x + 1 < sp_y:
                if self.grid.map.map[x][y].bottom != self.selected.lower():
                    self.grid.map.map[x][y].bottom = self.selected.lower()
                else:
                    self.grid.map.map[x][y].bottom = None
            else:
                if self.grid.map.map[x][y].left != self.selected.lower():
                    self.grid.map.map[x][y].left = self.selected.lower()
                else:
                    self.grid.map.map[x][y].left = None
        else:
            if -sp_x + 1 < sp_y:
                if self.grid.map.map[x][y].right != self.selected.lower():
                    self.grid.map.map[x][y].right = self.selected.lower()
                else:
                    self.grid.map.map[x][y].right = None
            else:
                if self.grid.map.map[x][y].top != self.selected.lower():
                    self.grid.map.map[x][y].top = self.selected.lower()
                else:
                    self.grid.map.map[x][y].top = None
        return x, y
    
    def add_walls(self, x, y):
        if self.selected.lower() == "building":
            if x != 0:
                if self.grid.map.map[x - 1][y].type != "building":
                    self.grid.map.map[x][y].walls = True
                    self.grid.map.map[x][y].left = "wall"
                else:
                    self.grid.map.map[x - 1][y].right = None
                    self.draw_grid_squares(x - 1, y)
            if y != 0:    
                if self.grid.map.map[x][y - 1].type != "building":
                    self.grid.map.map[x][y].walls = True
                    self.grid.map.map[x][y].top = "wall"
                else:
                    self.grid.map.map[x][y - 1].bottom = None
                    self.draw_grid_squares(x, y - 1)
            if x != self.grid.map.size - 1:    
                if self.grid.map.map[x + 1][y].type != "building":
                    self.grid.map.map[x][y].walls = True
                    self.grid.map.map[x][y].right = "wall"
                else:
                    self.grid.map.map[x + 1][y].left = None
                    self.draw_grid_squares(x + 1, y)
            if y != self.grid.map.size - 1:        
                if self.grid.map.map[x][y + 1].type != "building":
                    self.grid.map.map[x][y].walls = True
                    self.grid.map.map[x][y].bottom = "wall"
                else:
                    self.grid.map.map[x][y + 1].top = None
                    self.draw_grid_squares(x, y + 1)
        elif self.selected.lower() == "grass":
            self.grid.map.map[x][y].walls = False
            self.grid.map.map[x][y].top = None
            self.grid.map.map[x][y].left = None
            self.grid.map.map[x][y].right = None
            self.grid.map.map[x][y].bottom = None