# -*- coding: utf-8 -*-
"""
Created on Tue Oct 26 21:21:06 2021

@author: Ben Archer
"""
import pygame
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

class Wait_Menu(Main_Game):
    def __init__(self, message, width, height, screen):
        self.message = message
        self.width = width
        self.height = height
        self.screen = screen
        self.outline = 2
        self.setup = False
        self.redraw = []
        
        self.title_names = [self.message]
        self.titles = self.make_dicts(self.title_names)
        
        self.button_names = ["Back"]
        self.buttons = self.make_dicts(self.button_names)

        self.buttons["Back"].y_center = 0.75
    
    def run(self):
        if self.setup == False:
            self.run_setup()
        
        self.x, self.y = pygame.mouse.get_pos()
        self.in_buttons = dict(zip(self.button_names, [self.inside_box(box.size) for box in self.buttons.values()]))
        
        for name in self.redraw:
            if self.buttons[name].draw == True:
                self.draw_box(self.buttons[name])
            
        self.redraw = []
        
        for name in [name for (name, value) in self.in_buttons.items() if value == True]:
            if self.buttons[name].draw == True:
                self.draw_box_size(self.buttons[name].size, "gray", self.outline)
                self.redraw.append(name)
            
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.network.finish()
                return "game over"
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:
                    if True in self.in_buttons.values():
                        if self.in_buttons["Back"] == True:
                            self.setup = False
                            return "menu"
                    
        pygame.display.flip()
        
        return "wait menu"
        
    def run_setup(self):
        indent = self.width/10
        y_step = self.height/23
        x_step = self.width/10
        
        self.buttons["Back"].size = [x_step//2, y_step, x_step, y_step]
        self.titles[self.message].size = [2*indent, self.height/3 - y_step, self.width - 4*indent, self.height/3]
        
        self.screen.fill(colours[background_colour])
        
        for box in list(self.buttons.values()):
            self.draw_box(box)
            self.resize_font(box)
            self.write(box)
            
        for box in self.titles.values():
            self.resize_font(box)
            self.write(box)
        
        self.setup = True