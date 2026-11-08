# -*- coding: utf-8 -*-
"""
Created on Sat Dec 25 00:14:36 2021

@author: Ben Archer
"""

class Hit_Marker():
    def __init__(self, x1, y1, x2, y2, shot_type, start_tick):
        self.start = (x1, y1)
        self.end = (x2, y2)
        self.time = 2
        self.start_tick = start_tick
        self.rate = 60
        self.width = 3
        
        if shot_type == "hit":
            self.colour = "green"
        elif shot_type == "crit":
            self.colour = "blue"
        elif shot_type == "miss":
            self.colour = "red"
        else:
            print("Invalid Type")
            
    def calculate_width(self, tick):
        self.width = int(3 - 3/self.time*(tick - self.start_tick)/self.rate)
        
        if self.width < 1:
            return False
        else:
            return True
        
    
        