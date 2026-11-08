# -*- coding: utf-8 -*-
"""
Created on Sat Dec 25 06:27:24 2021

@author: Ben Archer
"""
from unit import Unit

class Assault(Unit):
    def __init__(self, unit_id, team, x, y, grid, units):
        self.type = "Assault"
        self.cost = 50
        self.max_health = 100
        self.max_energy = 100
        self.heal_rate = 10
        self.damage = 10
        self.range = 5
        self.shooting_angle = 2
        self.radius = .4
        self.colour = [200, 000, 000]
        
        if unit_id != -1:
            self.setup(unit_id, team, x, y, grid, units)

class Engineer(Unit):
    def __init__(self, unit_id, team, x, y, grid, units):
        self.type = "Engineer"
        self.cost = 50
        self.max_health = 100
        self.max_energy = 100
        self.heal_rate = 10
        self.damage = 10
        self.range = 5
        self.shooting_angle = 2
        self.radius = .4
        self.colour = [200, 000, 000]
        
        if unit_id != -1:
            self.setup(unit_id, team, x, y, grid, units)
            
class Scout(Unit):
    def __init__(self, unit_id, team, x, y, grid, units):
        self.type = "Scout"
        self.cost = 50
        self.max_health = 100
        self.max_energy = 100
        self.heal_rate = 10
        self.damage = 10
        self.range = 5
        self.shooting_angle = 2
        self.radius = .4
        self.colour = [200, 000, 000]
        
        if unit_id != -1:
            self.setup(unit_id, team, x, y, grid, units)
            
class Heavy(Unit):
    def __init__(self, unit_id, team, x, y, grid, units):
        self.type = "Heavy"
        self.cost = 50
        self.max_health = 100
        self.max_energy = 100
        self.heal_rate = 10
        self.damage = 10
        self.range = 5
        self.shooting_angle = 2
        self.radius = .4
        self.colour = [200, 000, 000]
        
        if unit_id != -1:
            self.setup(unit_id, team, x, y, grid, units)

class Sniper(Unit):
    def __init__(self, unit_id, team, x, y, grid, units):
        self.type = "Sniper"
        self.cost = 50
        self.max_health = 100
        self.max_energy = 100
        self.heal_rate = 10
        self.damage = 10
        self.range = 5
        self.shooting_angle = 2
        self.radius = .4
        self.colour = [200, 000, 000]
        
        if unit_id != -1:
            self.setup(unit_id, team, x, y, grid, units)
            
class Riot(Unit):
    def __init__(self, unit_id, team, x, y, grid, units):
        self.type = "Riot"
        self.cost = 50
        self.max_health = 100
        self.max_energy = 100
        self.heal_rate = 10
        self.damage = 10
        self.range = 5
        self.shooting_angle = 2
        self.radius = .4
        self.colour = [200, 000, 000]
        
        if unit_id != -1:
            self.setup(unit_id, team, x, y, grid, units)
            
class Commando(Unit):
    def __init__(self, unit_id, team, x, y, grid, units):
        self.type = "Commando"
        self.cost = 50
        self.max_health = 100
        self.max_energy = 100
        self.heal_rate = 10
        self.damage = 10
        self.range = 5
        self.shooting_angle = 2
        self.radius = .4
        self.colour = [200, 000, 000]
        
        if unit_id != -1:
            self.setup(unit_id, team, x, y, grid, units)
            
class Shotgun(Unit):
    def __init__(self, unit_id, team, x, y, grid, units):
        self.type = "Shotgun"
        self.cost = 50
        self.max_health = 100
        self.max_energy = 100
        self.heal_rate = 10
        self.damage = 10
        self.range = 5
        self.shooting_angle = 2
        self.radius = .4
        self.colour = [200, 000, 000]
        
        if unit_id != -1:
            self.setup(unit_id, team, x, y, grid, units)
    
            