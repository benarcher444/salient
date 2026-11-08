# -*- coding: utf-8 -*-
"""
Created on Tue Oct 26 21:20:02 2021

@author: Ben Archer
"""
import pygame
import numpy as np
from grid import Grid
from game import Main_Game

background_colour = "black"
text_colour = "white"
box_colour = "white"
hover_colour = "gray"
selected_colour = "black"
wall_width = 1/3

colours = {"black": (000, 000, 000),
           "white": (255, 255, 255),
           "gray":  (100, 100, 100),
           "green": (000, 100, 000),
           "dark red": (150, 000, 000),
           "dark blue": (000, 000, 100),
           "dark green": (17, 59, 8),
           "dark yellow": (204, 176, 9),
           "dark gray": (5, 5, 5),
           "water": (0,123,186),
           "purple": (100, 000, 100),
           "gold": (212, 175, 55),
           "brown": (155, 103, 60)}

map_colours = {"red base": "dark red",
               "blue base": "dark blue",
               "green base": "dark green",
               "yellow base": "dark yellow",
               "grass":     "green",
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

class Map_Menu(Main_Game):
    def __init__(self, maps, width, height, screen):
        self.maps = maps
        self.width = width
        self.height = height
        self.screen = screen
        self.outline = 5
        self.setup = False
        self.redraw = []
        self.map_choice = 0
        
        self.title_names = ["Map Menu"]
        self.titles = self.make_dicts(self.title_names)
        
        self.button_names = ["Default " + str(i) for i in range(10)]
        self.button_names.extend(["Back", "Edit"])
        self.buttons = self.make_dicts(self.button_names)
        
        outlines = [3 for i in range(10)]
        outlines.extend([5, 5])
        
        for i, box in enumerate(list(self.buttons.values())):
            box.y_center = 0.75
            box.outline = outlines[i]
    
    def run(self):
        if self.setup == False:
            self.run_setup()
            
        if self.grid.draw_map == True:
            self.draw_grid()
            self.grid.draw_map = False
        
        self.x, self.y = pygame.mouse.get_pos()
        self.in_buttons = dict(zip(self.button_names, [self.inside_box(box.size) for box in self.buttons.values()]))
        
        for name in self.redraw:
            self.draw_box(self.buttons[name])
            
        self.redraw = []
        
        for name in [name for (name, value) in self.in_buttons.items() if value == True]:
            self.draw_box_size(self.buttons[name].size, hover_colour, self.outline)
            self.redraw.append(name)
            
        for i in [i for i, (name, value) in enumerate(list(self.in_buttons.items())[:10]) if value == True]:
            self.map_choice = i
            self.grid = Grid(self.maps[self.map_choice], self.top_corner, self.bottom_corner)
        
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return "game over"
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:
                    if True in self.in_buttons.values():
                        self.setup = False
                        if self.in_buttons["Back"] == True:
                            return "menu"
                        elif self.in_buttons["Edit"] == True:
                            return "edit map"
                else:
                    self.zoom_grid(event.button)
        
        self.scroll_grid()
                    
        pygame.display.flip()
        
        return "map menu"
        
    def run_setup(self):   
        indent = self.width/20
        y_step = self.height/23
        x_step = self.width/10
        
        self.titles["Map Menu"].size = [indent*2 + x_step, y_step, self.width - x_step - 2*indent, y_step*1.5]
        
        self.buttons["Back"].size = [indent, y_step, x_step, y_step]
        self.buttons["Edit"].size = [self.width - 3*indent, y_step*21, x_step, y_step]
        
        for i, name in enumerate(list(self.buttons.keys())[:10]):
            self.buttons[name].text = self.maps[i].title
            self.buttons[name].size = [indent, y_step*(3 + 2*i), self.width/4, y_step]
        
        self.top_corner = np.array([indent*2 + self.width/4, y_step*3])
        self.bottom_corner = np.array([self.width - 3*indent + x_step, y_step*20])
        
        self.screen.fill(colours[background_colour])
        
        for box in self.buttons.values():
            self.draw_box(box)
            self.resize_font(box)
            self.write(box)
            
        for box in self.titles.values():
            self.resize_font(box)
            self.write(box)
        
        self.setup = True      
        
        self.grid = Grid(self.maps[self.map_choice], self.top_corner, self.bottom_corner)
        
        self.draw_map = True