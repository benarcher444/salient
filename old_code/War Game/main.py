# -*- coding: utf-8 -*-
"""
Created on Tue Oct 26 21:26:48 2021

@author: Ben Archer
"""
import pygame
import pickle
import sys
from grid import Map
from menu import Menu
from map_menu import Map_Menu
from edit_map import Edit_Map
from game_menu import Game_Menu
from proper_game import Game
from wait_menu import Wait_Menu
from player_info import Player_Info

def run_game():
    done = False
    height = 600
    width = 800
    gamemode = "menu"
    
    screen = pygame.display.set_mode((width, height))
    clock = pygame.time.Clock()
    pygame.display.set_caption("Game")
    
    try:
        maps = pickle.load(open('maps.dat','rb'))
    except:
        map_sizes = [30, 35, 40, 45, 50, 60, 70, 80, 90, 100]
        maps = [Map("Default " + str(i + 1), map_sizes[i]) for i in range(10)]
    
    menu = Menu(width, height, screen)
    map_menu = Map_Menu(maps, width, height, screen)
    edit_map = Edit_Map(maps, width, height, screen)
    
    try:
        while not done:
            if gamemode == "game over":
                done = True
            elif gamemode == "menu":
                gamemode =  menu.run()
            elif (gamemode == "hosting") | (gamemode == "joining"):
                game_menu = Game_Menu(gamemode, maps, width, height, screen)
                if game_menu.validation == gamemode:
                    gamemode = "game menu"
                else:
                    wait_menu = Wait_Menu(game_menu.validation, width, height, screen)
                    gamemode = "wait menu"
            elif gamemode == "wait menu":
                gamemode = wait_menu.run()
            elif gamemode == "map menu":
                gamemode = map_menu.run()
            elif gamemode == "edit map":
                gamemode = edit_map.run(map_menu.map_choice)
            elif gamemode == "game menu":
                gamemode = game_menu.run()
            elif gamemode == "started without":
                wait_menu = Wait_Menu(game_menu.validation, width, height, screen)
                gamemode = "wait menu"
            elif gamemode == "create game":
                game = Game(game_menu.validation.player_colour,  game_menu.map, game_menu.validation.name, game_menu.network, width, height, screen)
                gamemode = "play game"
            elif gamemode == "play game":
                gamemode = game.run()
            else:
                print("Gamemode:", gamemode)
                pygame.quit()
                done = True
            clock.tick(60)
            
    except KeyboardInterrupt:
        try:
            game_menu.checking = False
            game.checking = False
        except:
            pass
        
    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    run_game()