import sys, pygame
import math
import random
import pickle
import copy
import time

RED = [255,000,000]
DARK_RED = [110,000,000]
LIGHT_RED = [255,145,145]
YELLOW = [230,230,000]
DARK_YELLOW = [110,110,000]
LIGHT_YELLOW = [255,255,180]
GREEN = [000,200,000]
DARK_GREEN = [000,100,000]
LIGHT_GREEN = [180,255,180]
GRASS = [81,122,81]
NEON_BLUE = [000,255,255]
BLUE = [000,000,255]
DARK_BLUE = [000,000,105]
LIGHT_BLUE = [130,130,255]
PURPLE = [255,000,255]
DARK_PURPLE = [50,000,84]
LIGHT_PURPLE = [205,128,255]
BROWN = [210,69,32]
WHITE = [255,255,255]
DARK_GREY = [70,70,70]
GREY = [150,150,150]
LIGHT_GREY = [200,200,200]
BLACK = [000,000,000]
GOLD = [212,175,37]

### INITIAL SET UP

done = False

width = 1900
height = 1000

map_colours = [RED,BLUE,GREEN,YELLOW,DARK_GREEN,GREY,WHITE,BLACK,GOLD,DARK_GREY]

'''
map_colours[0] = Red
map_colours[1] = Blue
map_colours[2] = Green
map_colours[3] = Yellow
map_colours[4] = Grass
map_colours[5] = Building
map_colours[6] = Blank
map_colours[7] = Rock
map_colours[8] = Money
map_colours[9] = Command
'''

wall_colour = BLACK
halfwall_colour = LIGHT_BLUE

box_outline_colour = WHITE
hover_colour = GREY
clicked_colour = BLACK
text_colour = WHITE
background_colour = BLACK
gap = 1
wall_width = 4

# Initialising Fonts

pygame.font.init()

font_size = [pygame.font.SysFont(None,400)]

for i in range(150,1,-1):
    myfont = pygame.font.SysFont(None,i)
    font_size.append(myfont)

def fsc(text,box):
    # Takes text and decreases it's size until a fit is found
    no = 0
    fit = False
    while fit == False:
        myfont = font_size[no]
        txt_width,txt_height = myfont.size(text)
        if txt_width > box[2]:
            no += 1
        elif txt_height > box[3]:
            no += 1
        else:
            fit = True
    # Returns the new size fit
    return no

########### Setting up boxes and text

'''
box[0] = start_x
box[1] = start_y
box[2] = width
box[3] = height
box[4] = fill
box[5] = colour
box[6] = border_width
box[7] = inside
'''

#fps box

fps_b = [0,0,60,20,False,0,border,False]

#main screen

main_border = int(width/200)

main_name_b = [int(width/4),int(height/16),int(width/2),int(height/2),False,0,main_border,False]
main_game_b = [int(width/4),int(height/2),int(width/2),int(height/8),False,0,main_border,False]
main_maps_b = [int(width/4),int(height/4*3),int(width/2),int(height/8),False,0,main_border,False]

main_bs = [main_game_b,main_maps_b]

main_name_t = ["W.A.R",RED,True,0]
main_game_t = ["GAME",text_colour,True,0]
main_maps_t = ["MAPS",text_colour,True,0]

main_name_t[3] = fsc(main_name_t[0],main_name_b)
main_game_t[3] = fsc(main_game_t[0],main_game_b)
main_maps_t[3] = fsc(main_maps_t[0],main_maps_b)

#maps screen

no_of_maps = 10
maps_border = int(width/300)
maps_spacing = int(height/(no_of_maps*3+4))
indent = int(width/20)

maps_bs_1 = []
for i in range(no_of_maps):
    maps_bs_1.append[]
    maps_bs_1[i] = [spacing*(3*i+4),indent,int(width/3),spacing*2,False,0,maps_border,False]

### LOADING and SAVING MAPS

def load_maps():
    try:
        with open('maps.dat','rb') as file:
            maps = pickle.load(file)
    except:
        maps = []
        default_number = 30
        for row in range (10):
            maps.append([]),
            for column in range (default_number):
                maps[row].append([])
                for strand in range (default_number):
                    maps[row][column].append(BLANK)
                    
        for i in range(10):
            map_name = "MAP "+str(i+1)
            maps[i].append(map_name)
        
    return maps

def save_maps(maps):
    with open('Maps.dat', 'wb') as file:
        pickle.dump(maps, file)
        
### FOR TESTING

def print_grid(grid):
    for i in range(len(grid)):
        print (grid[i])

def t():
    print("hello")

def fps(clock,screen):
    fps = str(int(clock.get_fps()))
    fps_info = [fps,WHITE,False,False]
    write(fps_info,fps_b,screen)

### USEFUL FUNCTIONS

def draw_box(box,screen):
    # If fill is true, draw a box in that colour before drawing outline
    if box[4] == True:
        pygame.draw.rect(screen,box[5],(box[0],box[1],box[2],box[3]))
    if box[7] == False:
        pygame.draw.rect(screen,box_outline_colour,(box[0],box[1],box[2],box[3]),box[6])
    else:
        pygame.draw.rect(screen,hover_colour,(box[0],box[1],box[2],box[3]),box[6])

def write(text_info,box,screen):
    # If it is a variable size bit of text will do the font size everytime
    text,colour,centre,no = text_info[0],text_info[1],text_info[2],text_info[3] 
    if no == False:
        no = 0
        fit = False
        while fit == False:
            myfont = font_size[no]
            txt_width,txt_height = myfont.size(text)
            if txt_width > box[2]:
                no +=1
            elif txt_height > box[3]:
                no +=1
            else:
                fit = True
    else:
        myfont = font_size[no]
        txt_width,txt_height = myfont.size(text)
    # Prints the text on the screen
    mytext = myfont.render(text, 1, colour)
    if centre == True:
        screen.blit(mytext,(int(box[0]+box[2]/2)-txt_width/2,int((box[1]+box[3]/2)-txt_height/2)))
    else:
        screen.blit(mytext,(int(box[0]+box[5]),int((box[1]+box[3]/2)-txt_height/2)))

def inside(x,y,box):
    # Checks if the mouse is inside the box
    box[7] = False
    if x > box[0] and x < (box[0]+box[2]):
        if y > box[1] and y < (box[1]+box[3]):
            box[7] = True
    return box[7]

def mouse_pos():
    pos = pygame.mouse.get_pos()
    x = pos[0]
    y = pos[1]
    return x,y

### FUNCTIONS FOR DIFFERENT GAME SCREENS

def maps_screen(vital):
    screen = vital[0]
    x,y = pygame.mouse.get_pos()
    # Detects if the mous is in any of the boxes
    found = False
    while found == False:
        for i in range(len(main_bs)):
            main_bs[i][7] = inside(x,y,main_bs[i])
            if main_bs[i][7] == True:
                found = True
                vital[3] = i
                break
        break

    # DETECT INPUT ON MAIN SCREEN
    for event in pygame.event.get():
            if event.type == pygame.QUIT:
                done = True

    print(vital[3])
    
    return vital

def main_screen(vital):
    screen = vital[0]
    x,y = pygame.mouse.get_pos()
    # Detects if the mouse is in any of the boxes
    found = False
    while found == False:
        for i in range(len(main_bs)):
            main_bs[i][7] = inside(x,y,main_bs[i])
            if main_bs[i][7] == True:
                found = True
                break
        break
    
    # DETECT INPUT ON MAIN SCREEN
    for event in pygame.event.get():
            if event.type == pygame.QUIT:
                done = True
            
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:
                    if found == True:
                        if main_game_b[7] == True:
                            vital[1] = 3
                        elif main_maps_b[7] == True:
                            vital[1] = 1
            
                        
        
    # DRAWING PART
    screen.fill(background_colour)

    draw_box(main_game_b,screen)
    draw_box(main_maps_b,screen)

    # WRITING PART

    write(main_game_t,main_game_b,screen)
    write(main_name_t,main_name_b,screen)
    write(main_maps_t,main_maps_b,screen)

    # Return
    return(vital)

def main():
    # Set up of screen
    
    size = (width, height)
    screen = pygame.display.set_mode(size)
    clock = pygame.time.Clock()
    pygame.display.set_caption("My Game")
    pygame.init()

    # Setting up initial variables

    game_screen = 0
    game_mode = 0
    game_details = 0

    maps = 

    vital = [screen,game_screen,game_mode,game_details,done]

    '''
    vital[0] = screen
    vital[1] = game_screen
    vital[2] = game_mode
    vital[3] = game_details
    vital[4] = done
    '''

    # Start of main program

    while not done:
        if vital[1] == 0:
            vital = main_screen(vital)
        elif vital[1] == 1:
            vital = maps_screen(vital)

        fps(clock,vital[0])

        pygame.display.flip()
        clock.tick(60)

    pygame.quit()

if __name__ == "__main__":
    main()
