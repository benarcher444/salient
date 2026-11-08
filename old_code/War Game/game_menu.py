# -*- coding: utf-8 -*-
"""
Created on Tue Oct 26 21:21:06 2021

@author: Ben Archer
"""
import pygame
import numpy as np
from grid import Grid
from game import Main_Game
from network import Network
from player_info import Player_Info
import threading

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

class Game_Menu(Main_Game):
    def __init__(self, host, maps, width, height, screen):
        self.maps = maps
        self.map_choice = 0
        self.map = self.maps[self.map_choice]
        self.addr = "addr"
        player = Player_Info()
        player.player_type = host
        self.connected = {"addr": player}
        self.player_names = ["Red", "Blue", "Green", "Yellow"]
        self.width = width
        self.height = height
        self.screen = screen
        self.outline = 2
        self.setup = False
        self.selected = None
        self.checking = True
        self.redraw = []
        self.return_value = "game menu"
        
        self.connect_to_network(host)
        
        if self.validation != host:
            self.network.finish()
        else:
            self.input = threading.Thread(target = self.check_server)
            self.input.daemon = True
            self.input.start()
        
        self.title_names = ["Map Title", "Hosting"]
        self.titles = self.make_dicts(self.title_names)
        
        self.button_names = ["Back", "Do", "<", ">", "Red", "Blue", "Green", "Yellow"]
        self.buttons = self.make_dicts(self.button_names)
        
        for player in self.player_names:
            self.buttons[player].fill_colour = "dark " + player.lower()
            self.buttons[player].y_center = 0.5
          
        for i, box in enumerate(list(self.buttons.values())[:4]):
            box.y_center = [0.75, 0.75, 0, 0][i]
    
    def run(self):       
        if self.setup == False:
            self.run_setup()
            
        if self.grid.draw_map == True:
            self.draw_grid()
            self.grid.draw_map = False
        
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
        
        if self.selected != None:
            if self.buttons[self.selected].draw == True:
                self.draw_box_size(self.buttons[self.selected].size, "black", self.outline)
            
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.network.send(["finish"])
                self.checking = False
                return "game over"
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:
                    if True in self.in_buttons.values():
                        if self.in_buttons["Back"] == True:
                            self.setup = False
                            self.network.send(["finish"])
                            self.checking = False
                            return "menu"
                        if self.connected[self.addr].player_type == "hosting":
                            if self.in_buttons["<"] == True:
                                self.map_choice = (self.map_choice - 1) % 10
                                self.map = self.maps[self.map_choice]
                                self.setup = False
                            elif self.in_buttons[">"] == True:
                                self.map_choice = (self.map_choice + 1) % 10
                                self.map = self.maps[self.map_choice]
                                self.setup = False
                            elif self.in_buttons["Do"] == True:
                                if self.buttons["Do"].draw == True:
                                    self.connected[self.addr].player_type = "done setup"
                                    self.setup = False
                                    self.network.send(["setup", self.map, self.max_number_of_players, self.connected])
                        elif self.connected[self.addr].player_type == "done setup":
                            if self.in_buttons["Do"] == True:
                                if self.buttons["Do"].draw == True:
                                    self.setup = False
                                    self.checking = False
                                    self.network.send(["create game"])
                                    self.validation = self.connected[self.addr]
                                    self.return_value = "create game"

                        if self.connected[self.addr].player_type != "hosting":
                            for i in range(4):
                                if self.in_buttons[self.player_names[i]] == True:
                                    if self.buttons[self.player_names[i]].draw == True:
                                        free = True
                                        for value in self.connected.values():
                                            if value.player_colour == self.player_names[i]:
                                                free = False
                                                break
                                        if free:
                                            self.connected[self.addr].player_colour = self.player_names[i]
                                            self.selected = self.player_names[i]
                                        elif self.connected[self.addr].player_colour == self.player_names[i]:
                                            free = True
                                            self.connected[self.addr].player_colour = None
                                            self.selected = None
                                        if free == True:
                                            self.setup = False
                                            self.network.send(["connected", self.connected])
                                
                else:
                    self.zoom_grid(event.button)
                    
            elif event.type == pygame.KEYDOWN:
                if self.connected[self.addr].player_type != "hosting":
                    if event.key == pygame.K_BACKSPACE:
                        self.connected[self.addr].name = self.connected[self.addr].name[:-1]
                    else:
                        if len(self.connected[self.addr].name) < 10:
                            self.connected[self.addr].name += event.unicode
                    self.setup = False
                    self.network.send(["connected", self.connected])
            
        self.scroll_grid()
                    
        pygame.display.flip()
        
        return self.return_value
        
    def run_setup(self):
        indent = self.width/20
        y_step = self.height/23
        x_step = self.width/10
        
        self.top_corner = np.array([self.width/3 + indent/2, y_step*3])
        self.bottom_corner = np.array([self.width, y_step*20])
        
        self.grid = Grid(self.map, self.top_corner, self.bottom_corner)
        
        top = self.top_corner[1] + self.grid.excess_y/2
        distance = self.bottom_corner[1] - self.top_corner[1] - self.grid.excess_y/2
        step = distance/9
        
        self.titles["Map Title"].size = [self.top_corner[0], y_step*1.5, self.bottom_corner[0] - self.top_corner[0], y_step]
        self.titles["Hosting"].size = [indent, top*1.15, self.width/3 -indent/2, step]
        
        for i in range(4):
            self.buttons[self.player_names[i]].size = [indent, top + (i + 1)*step*2, self.width/3 -indent/2, step]
        
        self.buttons["Back"].size = [self.grid.excess_x/2, y_step, x_step, y_step]
        self.buttons["Do"].size = [self.width - x_step - self.grid.excess_x/2, y_step*21, x_step, y_step]
        self.buttons["<"].size = [self.top_corner[0] + self.grid.excess_x/2, y_step*1.5, y_step, y_step]
        self.buttons[">"].size = [self.width - self.grid.excess_x/2 - y_step, y_step*1.5, y_step, y_step]
        
        self.buttons["Red"].text = "Empty"
        self.buttons["Blue"].text = "Empty"
        self.buttons["Green"].text = "Empty"
        self.buttons["Yellow"].text = "Empty"
        
        if self.connected[self.addr].player_type == "hosting":
            self.buttons["Do"].text = "Host"
        elif self.connected[self.addr].player_type == "done setup":
            self.titles["Hosting"].text = self.connected[self.addr].name
            self.buttons["Do"].text = "Start"
            self.buttons["Do"].draw = True
            self.buttons["<"].draw = False
            self.buttons[">"].draw = False
        else:
            self.titles["Hosting"].text = self.connected[self.addr].name
            self.buttons["Do"].draw = False
            self.buttons["<"].draw = False
            self.buttons[">"].draw = False
            
        self.bases = self.map.bases
        
        self.max_number_of_players = 0
        
        for i in range(4):
            if len(self.bases[self.player_names[i].lower()]) > 0:
                self.buttons[self.player_names[i]].draw = True
                self.max_number_of_players += 1
            else:
                self.buttons[self.player_names[i]].draw = False
        
        if self.connected[self.addr].player_type == "hosting":
            if self.max_number_of_players < 2:
                self.buttons["Do"].draw = False
            else:
                self.buttons["Do"].draw = True
        
        for value in self.connected.values():
            if value.player_colour != None:
                self.buttons[value.player_colour].text = value.name
        
        if (self.connected[self.addr].player_type == "done setup") & (self.connected[self.addr].player_colour == None):
            self.buttons["Do"].draw = False
        
        self.titles["Map Title"].text = self.grid.map.title
        
        self.screen.fill(colours[background_colour])
        
        for box in list(self.buttons.values())[:4]:
            if box.draw == True:
                self.draw_box(box)
                self.resize_font(box)
                self.write(box)
                
        for i, box in enumerate(list(self.buttons.values())[4:]):
            if box.draw == True:
                self.draw_box_fill(box)
                box.font_size = self.resize_font(box, out = True) + 20
                box.font = font_size[box.font_size]
                self.write(box)
            
        for box in self.titles.values():
            self.resize_font(box)
            self.write(box)
            
        self.setup = True
        
    def connect_to_network(self, host):
        self.network = Network()
        for i in range(1):
            print("Trying to Connect: ", i + 1)
            connection_info = self.network.connect(host, self.map)
            if self.network.connected:
                print("Made Connection")
                self.addr = connection_info[1]
                self.connected = connection_info[2]
                self.validation = self.connected[self.addr].player_type
                self.map = connection_info[3]
                break
        
        if not self.network.connected:
            self.validation = "Unable to Connect to Server"

    def check_server(self):
        self.network.client.settimeout(10)
        while self.checking:
            try:
                data = self.network.receive()
                
                if data[0] == "ping":
                    self.network.send(["ping"])
                    
                elif data[0] == "connected":
                    self.connected = data[1]
                    self.setup = False
                    
                elif data[0] == "create game":
                    self.checking = False
                    self.setup = False
                    if self.selected != None:
                        self.validation = self.connected[self.addr]
                        self.return_value = "create game"
                    else:
                        self.validation = "No Team Selected When Game Started"
                        self.return_value = "started without"
                
            except:
                pass