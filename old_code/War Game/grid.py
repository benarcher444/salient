# -*- coding: utf-8 -*-
"""
Created on Fri Oct  8 16:14:16 2021

@author: Ben Archer
"""

class Grid():
    def __init__(self, which_map, top_corner, bottom_corner):
        self.map = which_map
        self.x = top_corner[0]
        self.y = top_corner[1]
        self.width = bottom_corner[0] - top_corner[0]
        self.height = bottom_corner[1] - top_corner[1]
        self.size = min(self.width, self.height)
        self.indent_x = 0
        self.indent_y = 0
        self.zoom = self.map.size
        self.left = [self.x, self.y, self.width/10, self.height]
        self.right = [self.x + 9*self.width/10, top_corner[1], self.width/10, self.height]
        self.top = [self.x, self.y, self.width, self.height/10]
        self.bottom = [self.x, self.y + 9*self.width/10, self.width, self.height/10]
        self.draw_map = True
        self.draw_units = True
        self.move = 1/10
        self.excess_x = self.width - self.size
        self.excess_y = self.height - self.size
        self.start_x = self.x + self.excess_x/2
        self.start_y = self.y + self.excess_y/2
        self.box = [self.start_x-1, self.start_y-1, self.size + 1, self.size + 2]
        self.sensitive_box = [self.start_x + 1, self.start_y + 1, self.size - 2, self.size - 2]
        self.lines = 1
        self.calculate_tile_size()
    
    def calculate_tile_size(self):
        if self.zoom > 50:
            self.lines = 1
            self.tile_size = (self.size - self.zoom + 1)/self.zoom
            return (self.size - self.zoom + 1)/self.zoom
            self.lines = 0
            return self.size/self.zoom
        else:
            self.lines = 1
            self.tile_size = (self.size - self.zoom + 1)/self.zoom
            return (self.size - self.zoom + 1)/self.zoom
    
    def move_left(self):
        self.indent_x += - self.move
        self.draw_map = True
    
    def move_right(self):
        self.indent_x += self.move
        self.draw_map = True
    
    def move_up(self):
        self.indent_y += - self.move
        self.draw_map = True
        
    def move_down(self):
        self.indent_y += self.move
        self.draw_map = True
        
    def zoom_reset(self):
        self.indent_x = 0
        self.indent_y = 0
        self.zoom = self.map.size
        self.draw_map = True
        
    def zoom_in(self):
        if self.zoom > 8:
            self.indent_x += 1
            self.indent_y += 1
            self.zoom += -2
            self.draw_map = True
        
    def zoom_out(self):
        if self.zoom < self.map.size:
            self.zoom += 2
            self.draw_map = True
        if self.indent_x > 1:
            self.indent_x += -1
            self.draw_map = True
        if self.indent_y > 1:
            self.indent_y += -1
            self.draw_map = True
        if self.zoom + self.indent_x > self.map.size:
            self.indent_x += -1
            self.draw_map = True
        if self.zoom + self.indent_y > self.map.size:
            self.indent_y += -1
            self.draw_map = True
    
    def add(self):
        if self.map.size < 100:
            self.draw_map = True
            self.map.size += 1
            for row in self.map.map:
                row.append(Tile())
            self.map.map.append([Tile() for i in range(self.map.size)])
            self.zoom = self.map.size
            self.indent_x = 0
            self.indent_y = 0
        
    def delete(self):
        if self.map.size > 20:
            self.draw_map = True
            self.map.size += -1
            self.map.map.pop()
            for row in self.map.map:
                row.pop()
            self.zoom = self.map.size
            self.indent_x = 0
            self.indent_y = 0
    
    def unnecessary_walls(self):
        for i in range(self.map.size):
            for j in range(self.map.size):
                if self.map.map[i][j].walls == True:
                    if (self.map.map[i][j].top == None) & (self.map.map[i][j].left == None) & (self.map.map[i][j].bottom == None) & (self.map.map[i][j].right == None):
                        self.map.map[i][j].walls = False
        
class Map():
    def __init__(self, map_title, size):
        self.title = map_title
        self.size = size
        self.map = [[Tile() for i in range(self.size)] for i in range(self.size)]
        self.count_bases()
        
    def count_bases(self):
        self.bases = {"red": [], "blue": [], "green": [], "yellow": []}
        self.command_posts = []
        self.income_squares = []
        bases = ["red base", "blue base", "green base", "yellow base"]
        for i in range(self.size):
            for j in range(self.size):
                tile_type = self.map[i][j].type
                if tile_type in bases:
                    self.bases[tile_type[:-5]].append([i, j])
                    
                elif tile_type == "command":
                    self.command_posts.append(Command_Post(i, j))
                
                elif tile_type == "income":
                    self.income_squares.append(Income_Square(i, j))

class Tile():
    def __init__(self, tile_type = "grass"):
        self.type = tile_type
        self.walls = False
        self.top = None
        self.bottom = None
        self.right = None
        self.left = None

class Wall():
    def __init__(self, x, y, orientation, type_of_wall):
        self.x = x
        self.y = y
        self.orientation = orientation
        self.wall = type_of_wall
        
class Command_Post():
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.team = None
        
class Income_Square():
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.value = 5
        