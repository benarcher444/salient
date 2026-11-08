# -*- coding: utf-8 -*-
"""
Created on Thu Oct  7 17:35:25 2021

@author: Ben Archer
"""

class Box():
    def __init__(self, text = "Default", size = [0,0,0,0], colour = "white", font_colour = "white", outline = 1, fill_colour = "white"):
        self.text = text
        self.font = None
        self.size = size
        self.colour = colour
        self.font_colour = font_colour
        self.outline = outline
        self.in_box = False
        self.fill_colour = fill_colour
        self.redraw = False
        self.draw = True
        self.x_center = 1
        self.y_center = 0.5
        