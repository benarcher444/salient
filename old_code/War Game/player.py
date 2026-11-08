# -*- coding: utf-8 -*-
"""
Created on Wed Nov 10 17:36:13 2021

@author: Ben Archer
"""

class Player():
    def __init__(self, player, player_name):
        self.player = player
        self.name = player_name
        self.gold = 1000
        self.income = 10
        self.extra_income = 0
        self.turn = 1
        self.unit_id = 1
        
    def end_turn(self):
        self.gold += self.income + self.extra_income
        self.turn += 1