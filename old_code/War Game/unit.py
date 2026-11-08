# -*- coding: utf-8 -*-
"""
Created on Mon Oct 11 23:08:54 2021

@author: Ben Archer
"""
from math import pi, atan, sin, cos

class Unit():
    def __init__(self, unit_id, team, x, y, grid, units):
        self.type = "Basic Unit"
        self.cost = 50
        self.max_health = 100
        self.max_energy = 10000
        self.heal_rate = 10
        self.damage = 200
        self.range = 10
        self.shooting_angle = 2
        self.radius = .4
        self.colour = [000, 000, 000]
        if unit_id != -1:
            self.setup(unit_id, team, x, y, grid, units)
        
    def setup(self, unit_id, team, x, y, grid, units):
            self.id = unit_id
            self.units = units
            self.team = team
            self.speed = .02
            self.health = self.max_health
            self.energy = self.max_energy
            self.orientation = - pi/2
            self.damage_taken = 0
            self.x = x + .5
            self.y = y + .5
            self.grid = grid
            self.position()
            self.calculate_colour()
            self.calculate_edge_colour()
            self.which_squares()
            self.move_type = None
            self.visible = True
    
    def in_square(self, x, y, radius):
        return (self.x - (x + 0.5))**2  + (self.y - (y + 0.5))**2 < (self.radius + radius)**2
    
    def alone(self, units):
        for unit in units:
            x, y = unit.which_tile()
            if (x == self.selected_box[0]) & (y == self.selected_box[1]):
                return False
        return True
    
    def which_tile(self):
        return self.x//10, self.y//10
    
    def position(self):
        self.x_pos = self.grid.start_x + (int(self.x) - int(self.grid.indent_x))*(self.grid.tile_size + 1) - 1 + (self.x - int(self.x))*(self.grid.tile_size + 1)
        self.y_pos = self.grid.start_y + (int(self.y) - int(self.grid.indent_y))*(self.grid.tile_size + 1) - 1 + (self.y - int(self.y))*(self.grid.tile_size + 1)
    
    def in_unit(self, x, y):
        if (self.x_pos - x)**2 + (self.y_pos - y)**2 <= (self.grid.tile_size*self.radius)**2:
            return True
        else:
            return False
        
    def calculate_colour(self):
        self.center = (255*(1 - self.health/self.max_health)**0.5, 255*(self.health/self.max_health), 0)
        
    def calculate_edge_colour(self):
        self.edge_center = (255*self.energy/self.max_energy, 255*self.energy/self.max_energy, 255*self.energy/self.max_energy)
        
    def redirect(self, x_mos, y_mos):
        if self.move_type != "attacked":
            self.move_type = "moved"
            x_diff = (x_mos - self.x_pos)
            y_diff = (y_mos - self.y_pos)
            if x_diff == 0:
                if y_diff > 0:
                    self.orientation = pi/2
                else:
                    self.orientation = -pi/2
            else:
                if x_diff > 0:
                    self.orientation = atan(y_diff/x_diff)
                else:
                    self.orientation = atan(y_diff/x_diff) + pi
                
    def which_squares(self):
        x_whole = int(self.x)
        x_remainder = self.x - int(self.x)
        y_whole = int(self.y)
        y_remainder = self.y - int(self.y)
        self.squares = {(x_whole, y_whole)}
        right = False
        left = False
        if x_remainder + self.radius > 1:
            self.squares.add((x_whole + 1, y_whole))
            right = True
        elif x_remainder - self.radius < 0:
            self.squares.add((x_whole - 1, y_whole))
            left = True
        if y_remainder + self.radius > 1:
            self.squares.add((x_whole, y_whole + 1))
            if right == True:
                if (self.x - x_whole - 1)**2 + (self.y - y_whole - 1)**2 < self.radius**2:
                    self.squares.add((x_whole + 1, y_whole + 1))
            elif left == True:
                if (self.x - x_whole)**2 + (self.y - y_whole - 1)**2 < self.radius**2:
                    self.squares.add((x_whole - 1, y_whole + 1))
        elif y_remainder - self.radius < 0:
            self.squares.add((x_whole, y_whole - 1))
            if right == True:
                if (self.x - x_whole - 1)**2 + (self.y - y_whole)**2 < self.radius**2:
                    self.squares.add((x_whole + 1, y_whole - 1))
            elif left == True:
                if (self.x - x_whole)**2 + (self.y - y_whole)**2 < self.radius**2:
                    self.squares.add((x_whole - 1, y_whole - 1))
        
    def move(self, holding):
        if (self.energy > 0) & (self.move_type != "attacked"):
            moved = [False for i in range(4)]
            if holding[0] == True:
                moved[0] = self.move_up()
            if holding[1] == True:
                moved[1] = self.move_left()
            if holding[2] == True:
                moved[2] = self.move_down()
            if holding[3] == True:
                moved[3] = self.move_right()
            if True in moved:
                self.move_type = "moved"
                self.energy -= 1
                self.calculate_edge_colour()
                return True
        self.which_squares()
        return False
                
    def move_up(self):
        if self.y - self.speed - self.radius > 0:
            self.y -= self.speed
            self.which_squares()
            if self.in_walls():
                self.y += self.speed
            else:
                return True
        return False
            
    def move_down(self):
        if self.y + self.speed + self.radius < self.grid.map.size:
            self.y += self.speed
            self.which_squares()
            if self.in_walls():
                self.y -= self.speed
            else:
                return True
        return False
        
    def move_left(self):
        if self.x - self.speed - self.radius > 0:
            self.x -= self.speed
            self.which_squares()
            if self.in_walls():
                self.x += self.speed
            else:
                return True
        return False
        
    def move_right(self):
        if self.x + self.speed + self.radius < self.grid.map.size:
            self.x += self.speed
            self.which_squares()
            if self.in_walls():
                self.x -= self.speed
            else:
                return True
        return False
    
    def in_walls(self):
        wall_width = 1/3
        outer_squares = set()
        for x, y in self.squares:
            left = False
            right = False
            if x > 0:
                outer_squares.add((x - 1, y))
                left = True
            if x < self.grid.map.size - 1:
                outer_squares.add((x + 1, y))
                right = True
            if y > 0:
                outer_squares.add((x, y - 1))
                if left == True:
                    outer_squares.add((x - 1, y - 1))
                if right == True:
                    outer_squares.add((x + 1, y - 1))
            if y < self.grid.map.size - 1:
                outer_squares.add((x, y + 1))
                if left == True:
                    outer_squares.add((x - 1, y + 1))
                if right == True:
                    outer_squares.add((x + 1, y + 1))
        
        clip = lambda x, l, u: l if x < l else u if x > u else x
        
        for x, y in self.squares:
            if (self.grid.map.map[x][y].type == "rock") | (self.grid.map.map[x][y].type == "water"):
                return True
            if self.grid.map.map[x][y].walls == True:
                if self.grid.map.map[x][y].top != None:
                    x_point = clip(self.x, x, x + 1)
                    if self.point_in_unit(x_point, y + wall_width):
                        return True
                if self.grid.map.map[x][y].left != None:
                    y_point = clip(self.y, y, y + 1)
                    if self.point_in_unit(x + wall_width, y_point):
                        return True
                if self.grid.map.map[x][y].bottom != None:
                    x_point = clip(self.x, x, x + 1)
                    if self.point_in_unit(x_point, y + 1 - wall_width):
                        return True
                if self.grid.map.map[x][y].right != None:
                    y_point = clip(self.y, y, y + 1)
                    if self.point_in_unit(x + 1 - wall_width, y_point):
                        return True
        
        for x, y in outer_squares:
            if self.grid.map.map[x][y].walls == True:
                if self.grid.map.map[x][y].top != None:
                    x_point = clip(self.x, x, x + 1)
                    if self.point_in_unit(x_point, y):
                        return True
                    y_point = clip(self.y, y, y + wall_width)
                    if self.point_in_unit(x, y_point):
                        return True
                    if self.point_in_unit(x + 1, y_point):
                        return True
                if self.grid.map.map[x][y].left != None:
                    y_point = clip(self.y, y, y + 1)
                    if self.point_in_unit(x, y_point):
                        return True
                    x_point = clip(self.x, x, x + wall_width)
                    if self.point_in_unit(x_point, y):
                        return True
                    if self.point_in_unit(x_point, y + 1):
                        return True
                if self.grid.map.map[x][y].bottom != None:
                    x_point = clip(self.x, x, x + 1)
                    if self.point_in_unit(x_point, y + 1):
                        return True
                    y_point = clip(self.y, y + 1 - wall_width, y + 1)
                    if self.point_in_unit(x, y_point):
                        return True
                    if self.point_in_unit(x + 1, y_point):
                        return True
                if self.grid.map.map[x][y].right != None:
                    y_point = clip(self.y, y, y + 1)
                    if self.point_in_unit(x + 1, y_point):
                        return True
                    x_point = clip(self.x, x + 1 - wall_width, x + 1)
                    if self.point_in_unit(x_point, y):
                        return True
                    if self.point_in_unit(x_point, y + 1):
                        return True
        
        for unit in self.units:
            if unit.id != self.id:
                if (self.x - unit.x)**2 + (self.y - unit.y)**2 < (self.radius + unit.radius)**2:
                    return True
        
        return False
        
    def point_in_unit(self, x, y):
        if (self.x - x)**2 + (self.y - y)**2 < self.radius**2:
            return True
        else:
            return False
        
    def off_edge(self):
        if self.x_pos + self.radius*self.grid.tile_size > self.grid.indent_x + self.grid.width - self.radius*self.grid.tile_size:
            return True
        else:
            return False
        
    def accuracy(self, dist, angle):
        if (abs(angle - self.orientation) < self.shooting_angle/2) | (abs(angle - self.orientation) > 2*pi - self.shooting_angle/2):
            if dist < self.range:
                return 1
        return 0
    
    def calculate_damage(self, dist, angle, target_orientation):
        front_side = 1
        if (abs(angle - target_orientation) < front_side) | (abs(angle - target_orientation) > 2*pi - front_side):
            return self.damage*2
        elif (abs(angle - target_orientation - pi) < front_side) | (abs(angle - target_orientation - pi) > 2*pi - front_side):
            return self.damage
        else:
            return self.damage*0.5
        
    def crit(self):
        return 0.05
        
    def end_turn(self):
        self.energy = self.max_energy
        if self.health == 0:
            return True
        self.health = min(self.max_health, self.health + self.heal_rate)
        self.damage_taken = 0
        self.move_type = None
        self.calculate_colour()
        self.calculate_edge_colour()
        return False