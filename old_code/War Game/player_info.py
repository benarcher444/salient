# -*- coding: utf-8 -*-
"""
Created on Fri Dec 17 00:21:04 2021

@author: Ben Archer
"""
class Player_Info():
    def __init__(self, no = 0):
        self.name = "Player " + str(no + 1) 
        self.player_colour = None
        self.player_type = None