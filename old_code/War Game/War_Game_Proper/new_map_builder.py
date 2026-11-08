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

no = 0
BLANK = 0
RED_BASE = 1
BLUE_BASE = 2
GREEN_BASE = 3
YELLOW_BASE = 4
GRASS = 5
OBSTACLE = 7
ROOM = 6
DOOR = 8
WINDOW = 9
MONEY = 10
CHECKPOINT = 15

main_menu_value = 0
maps_menu_value = 1
build_maps_value = 2
game_set_up_value = 3
game_load_value = 4

# Initialising Fonts

pygame.font.init()

font_size = []

for i in range(150,1,-1):
    myfont = pygame.font.SysFont(None,i)
    font_size.append(myfont)

box_colour = WHITE
hover_colour = GREY
clicked_colour = BLACK
window_colour = LIGHT_BLUE
wall_colour = BLACK
gap = 1
values_before = 10
wall_width = 4
check_around = [[0,0,-1,wall_width,-1,0],[0,0,wall_width,-1,0,-1],[1,0,1,wall_width,1,0],[0,1,wall_width,1,0,1]]

maps_menu_no_of_boxes = 10

build_map_no_of_first_boxes = 6
build_map_colours_for_first = [RED_BASE,GREEN_BASE,GRASS,OBSTACLE,DOOR,MONEY]
build_map_colours_for_second = [BLUE_BASE,YELLOW_BASE,ROOM,BLANK,WINDOW,CHECKPOINT]
build_map_text_for_third_boxes = ["PLAYER COUNT","CHECKPOINT COUNT","MONEYPOINT COUNT","BLANK SPACES LEFT"]
build_map_no_of_third_boxes = len(build_map_text_for_third_boxes)

def colour_setter(value):
    colours = [WHITE,RED,BLUE,GREEN,YELLOW,DARK_GREEN,GREY,BLACK,LIGHT_GREY,GREY,GOLD,DARK_GREY]
    try:
        if value < values_before:
            colour = colours[value]
        elif value > values_before-1:
            value = (value - values_before)//5
            colour = colours[value+values_before]
    except:
        colour = value
        
    return colour

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

def print_grid(grid):
    for i in range(len(grid)):
        print (grid[i])

def t():
    print("hello")

def grey_outline(x,y,detes,hover_colour):
    inside = inside_box(x,y,detes)
    if inside == True:
        detes[4] = hover_colour
    return inside

def draw_map(crucial,maps,screen,start_x,start_y,size):
    width = crucial[1]
    height = crucial[2]
    game_mode = crucial[0]
    grid = maps[crucial[5]]

    no_across = len(maps[crucial[5]])-1
    square_size = int(size/(no_across-crucial[11])-gap)

    adjust = square_size+gap

    full_walls = []
    window_walls = []

    for row in range(no_across-crucial[11]):
        for column in range(no_across-crucial[11]):
            value = grid[row+crucial[13]][column+crucial[12]]
            colour = colour_setter(value)
            box = [start_x+row*adjust,start_y+column*adjust,square_size,square_size,colour,0,screen]
            draw_box(box,False,0)
            if value > values_before-1:
                new_value = value-values_before
                if new_value < 5:
                    text = "£"
                    text_colour = BLACK
                    border_colour = colour_setter(new_value)
                else:
                    text = "!"
                    text_colour = WHITE
                    border_colour = colour_setter(new_value-5)
                write(text,text_colour,box,True)
                box = [start_x+row*adjust,start_y+column*adjust,square_size,square_size,border_colour,1,screen]
                draw_box(box,False,0)
            colour = wall_colour
            if value == WINDOW:
                colour = window_colour
                value = ROOM
            if value == ROOM or value >= RED_BASE and value <= YELLOW_BASE:
                for i in range(4):
                    try:
                        next_value = int(grid[row+crucial[13]+check_around[i][4]][column+crucial[12]+check_around[i][5]]) 
                    except:
                        next_value = 0
                    if row+crucial[13]+check_around[i][4] > crucial[13]+(no_across-crucial[11])-1:
                        next_value = 0
                    elif row+crucial[13]+check_around[i][4] < crucial[13]:
                        next_value = 0
                    elif column+crucial[12]+check_around[i][5] > crucial[12]+(no_across-crucial[11])-1:
                        next_value = 0
                    elif column+crucial[12]+check_around[i][5] < crucial[12]:
                        next_value = 0
                    if (value == ROOM and (next_value == GRASS or (next_value >= RED_BASE and next_value <= YELLOW_BASE))) or ((value >= RED_BASE and value <= YELLOW_BASE) and (next_value == GRASS or ((next_value >= RED_BASE and next_value <= YELLOW_BASE) and next_value != value))) or (value == OBSTACLE):
                        box = [int(start_x+(row+check_around[i][0])*adjust),int(start_y+(column+check_around[i][1])*adjust),int(square_size*check_around[i][2]/wall_width),int(square_size*check_around[i][3]/wall_width),colour,0,screen]
                        if colour == wall_colour: 
                            full_walls.append(box)
                        else:
                            window_walls.append(box)

    for i in full_walls:
        draw_box(i,False,0)
    for i in window_walls:
        draw_box(i,False,0)
        
    return square_size

def draw_box(detes,fill,value):
    if fill == True:
        colour = colour_setter(value)
        pygame.draw.rect(detes[6],colour,(detes[0],detes[1],detes[2],detes[3]))
    pygame.draw.rect(detes[6],detes[4],(detes[0],detes[1],detes[2],detes[3]),detes[5])

def inside_box(x,y,detes):
    inside = False
    if x > detes[0] and x < (detes[0]+detes[2]):
        if y > detes[1] and y < (detes[1]+detes[3]):
            inside = True
    return inside

def box_grid(number,start_x,start_y,width,height,space,colour,border,screen):
    boxes = []
    for row in range (number):
        boxes.append([])
        boxes[row] = [start_x,start_y+row*(height+space),width,height,colour,border,screen]
    return boxes
    
# box = [x,y,width,height,colour,border,screen]

def mouse_pos():
    pos = pygame.mouse.get_pos()
    x = pos[0]
    y = pos[1]
    return x,y

def write(text,colour,detes,centre,shift=1,no=0):
    fit = False
    while fit == False:
        myfont = font_size[no]
        txt_width,txt_height = myfont.size(text)
        if txt_width > detes[2]:
            no +=1
        elif txt_height > detes[3]:
            no +=1
        else:
            fit = True
    mytext = myfont.render(text, 1, colour)
    if centre == True:
        detes[6].blit(mytext,(int(detes[0]+detes[2]/2)-txt_width/2,int((detes[1]+detes[3]/2)-shift*txt_height/2)))
    else:
        detes[6].blit(mytext,(int(detes[0]+detes[5]),int((detes[1]+detes[3]/2)-txt_height/2)))
    return no

def Write_file(maps):
    with open('Maps.dat', 'wb') as file:
        pickle.dump(maps, file)

def letters(text,previous_time,event):
    if event.type == pygame.KEYDOWN:
        now_time = time.time()
        space = now_time - previous_time
        previous_time = now_time
        press=pygame.key.get_pressed()
        partial_name = ""
        capatalise = False
        delete = False
        for i in range(len(press)):
            if press[i] == 1:
                add = False
                letter = pygame.key.name(i)
                number = 0
                for J in letter:
                    number += 1
                if number == 1:
                    add = True
                elif letter == "space":
                    letter = " "
                    add = True
                elif letter == "left shift" or letter == "right shift" or letter == "caps lock":
                    add = True
                    capatalise = True
                    letter = ""
                elif letter == "backspace":
                    letter = ""
                    delete = True
                if len(text) > 0:
                    if letter == text[len(text)-1]:
                        if space < 0.11:
                            add = False
                if len(text) > 25:
                    add = False
                if add == True:
                    partial_name = partial_name + letter

        if delete == True:
            text = text[:-1]
        elif capatalise == True:            
            text = text + partial_name.upper()
        else:
            text = text + partial_name
    
    return text,previous_time

def zoom_reset(crucial):
    crucial[11] = 0
    crucial[12] = 0
    crucial[13] = 0
    return crucial

def scrolling(crucial,scroll_boxes,x,y):
    
    inside_scroll_boxes = []

    for i in range(len(scroll_boxes)):
        inside = grey_outline(x,y,scroll_boxes[i],hover_colour)
        inside_scroll_boxes.append(inside)

    now_time = time.time()
    difference = now_time - crucial[14]
    if difference > 0.1:
        crucial[14] = now_time
        if inside_scroll_boxes[0]:
            if crucial[12] > 0:
                crucial[12] += -1
                crucial[16] = True
        elif inside_scroll_boxes[1]:
            if crucial[12] < crucial[11]:
                crucial[12] += 1
                crucial[16] = True
        elif inside_scroll_boxes[2]:
            if crucial[13] > 0:
                crucial[13] += -1
                crucial[16] = True
        elif inside_scroll_boxes[3]:
            if crucial[13] < crucial[11]:
                crucial[13] += 1
                crucial[16] = True
    return crucial

def mouse_scrolling(crucial,event,no_of_rows):
    if event.button == 2:
        crucial = zoom_reset(crucial)
    elif event.button == 4:
        if crucial[11] < no_of_rows-1:
            crucial[11] += 1
    elif event.button == 5:
        if crucial[11] > 0:
            crucial[11] += -1
            if crucial[12] > 0:
                crucial[12] += -1
            if crucial[13] > 0:
                crucial[13] += -1
    crucial[16] = True
    return crucial

def arrow_keys(build_info,add,value_1,value_2,value_3,value_4):
    if build_info[0] == value_1:
        build_info[4] = True
        build_info[0] = 0
    elif build_info[0] == 0:
        if build_info[4] == True:
            build_info[0] = value_2
            build_info[4] = False
        else:
            build_info[0] += add
            if build_info[0] == value_3:
                build_info[0] = value_4
    else:
        build_info[0] += add
        if build_info[0] == value_3:
            build_info[0] = value_4
    return build_info

def clear_box_button(maps,crucial,build_info):
    if build_info[0] < values_before:
        for i in range(len(maps[crucial[5]])-1):
            for j in range(len(maps[crucial[5]][0])):
                maps[crucial[5]][i][j] = build_info[0]
                crucial[16] = True
    else:
        for i in range(len(maps[crucial[5]])-1):
            for j in range(len(maps[crucial[5]][0])):
                maps[crucial[5]][i][j] = BLANK
                crucial[16] = True
    return maps,crucial

def fps(clock,crucial):
    fps = str(int(clock.get_fps()))
    write(fps,WHITE,crucial[15],False)
                
#####################################################################################################
    
def main_menu(screen,clock,crucial):
    width = crucial[1]
    height = crucial[2]
    border = crucial[3]
    title_box = [int(width/4),int(height/8),int(width/2),int(height/3),box_colour,border,screen]
    box_1 = [int(width/4),int(height/2),int(width/2),int(height/8),box_colour,border,screen]
    box_2 = [int(width/4),int(height/4*3),int(width/2),int(height/8),box_colour,border,screen]

    x,y = mouse_pos()

    inside_1 = inside_box(x,y,box_1)
    inside_2 = inside_box(x,y,box_2)
    if inside_1 == True:
        box_1[4] = hover_colour
    elif inside_2 == True:
        box_2[4] = hover_colour
    
    for event in pygame.event.get():
            if event.type == pygame.QUIT:
                crucial[6] = True
            elif event.type == pygame.KEYDOWN:
                key = pygame.key.name(event.key)
                if key == "f11":
                    crucial[8] = not crucial[8]
                    crucial[1],crucial[9] = crucial[9],crucial[1]
                    crucial[2],crucial[10] = crucial[10],crucial[2]
                    if crucial[8] == True:
                        screen = pygame.display.set_mode((crucial[1],crucial[2]),pygame.FULLSCREEN)
                    else:
                        screen = pygame.display.set_mode((crucial[1],crucial[2]))
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:
                    if inside_1 == True:
                        crucial[0] = game_set_up_value
                    elif inside_2 == True:
                        crucial[0] = maps_menu_value
                
    screen.fill(BLACK)

    draw_box(box_1,True,WHITE)
    draw_box(box_2,True,WHITE)

    write("GAME",BLACK,box_1,True)
    write("MAPS",BLACK,box_2,True)
    write("W.A.R",RED,title_box,True)

    fps(clock,crucial)
    pygame.display.flip()
    clock.tick(60)
    
    return crucial

####################################################################

def maps_menu(screen,clock,crucial,maps):
    width = crucial[1]
    height = crucial[2]
    border = int(width/300)
    spacing = int(height/(maps_menu_no_of_boxes*3+4))
    indent = width/20
    no_of_rows = len(maps[crucial[5]])-1
    start_y = height/40
    start_x = 23/60*width + (37/60*width - 19/20*height)/2
    size = height/20*19
    scroll_box_size = int(height/20)

    back_box = [indent,spacing,int(width/12),spacing,box_colour,int(border/2),screen]
    boxes = box_grid(maps_menu_no_of_boxes,indent,spacing*4,width/3,spacing*2,spacing,box_colour,border,screen)
    maps_box = [int(3*indent/2+width/12),int(2*spacing/3),width/5,int(8*spacing/3),box_colour,0,screen]
    scroll_up_box = [start_x,start_y,size,scroll_box_size,box_colour,int(border/2),screen]
    scroll_down_box = [start_x,start_y+size-scroll_box_size,size,scroll_box_size,box_colour,int(border/2),screen]
    scroll_left_box = [start_x,start_y,scroll_box_size,size,box_colour,int(border/2),screen]
    scroll_right_box = [start_x+size-scroll_box_size,start_y,scroll_box_size,size,box_colour,int(border/2),screen]
    scroll_boxes = [scroll_up_box,scroll_down_box,scroll_left_box,scroll_right_box]
    black_left = [0,0,start_x,height,BLACK,0,screen]

    x,y = mouse_pos()

    inside = []

    crucial = scrolling(crucial,scroll_boxes,x,y)

    in_a_box = False

    previous_map = crucial[5]
    
    for i in range(maps_menu_no_of_boxes):
        inside.append(False)
        inside[i] = inside_box(x,y,boxes[i])

        if inside[i] == True:
            boxes[i][4] = hover_colour
            crucial[5] = i
            in_a_box = True
            crucial[16] = True

    if crucial[5] != previous_map:
        crucial  = zoom_reset(crucial)

    inside_back = inside_box(x,y,back_box)
    if inside_back == True:
        back_box[4] = hover_colour

    if crucial[16] == True:
        screen.fill(BLACK)
        draw_map(crucial,maps,screen,start_x,start_y,size)
        crucial[16] = False
    else:
        draw_box(black_left,False,0)

    draw_box(back_box,True,WHITE)

    for i in range(maps_menu_no_of_boxes):
        draw_box(boxes[i],True,WHITE)
        write(maps[i][len(maps[i])-1],BLACK,boxes[i],False)

    write("BACK",BLACK,back_box,True)
    write("MAPS",WHITE,maps_box,True)

    fps(clock,crucial)
    pygame.display.flip()
    clock.tick(60)
    
        
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            crucial[6] = True
        elif event.type == pygame.KEYDOWN:
            key = pygame.key.name(event.key)
            if key == "f11":
                crucial[8] = not crucial[8]
                crucial[1],crucial[9] = crucial[9],crucial[1]
                crucial[2],crucial[10] = crucial[10],crucial[2]
                if crucial[8] == True:
                    screen = pygame.display.set_mode((crucial[1],crucial[2]),pygame.FULLSCREEN)
                else:
                    screen = pygame.display.set_mode((crucial[1],crucial[2]))
        elif event.type == pygame.MOUSEBUTTONDOWN:
            if event.button == 1:
                if in_a_box == True:
                    crucial[0] = build_maps_value
                    crucial[16] = True
                elif inside_back == True:
                    crucial[0] = main_menu_value
                    crucial[16] = True
            else:
                crucial = mouse_scrolling(crucial,event,no_of_rows)
            
    return crucial

# box = [x,y,width,height,colour,border,screen]

def game_set_up(screen,clock,crucial,maps):
    width = crucial[1]
    height = crucial[2]
    border = crucial[3]
    top_spacing = int(width/9)
    vertical_spacing = int(height/39)
    size = int(19*height/20-vertical_spacing*6)
    mid_spacing = int((19*width/20 - size)/20)
    start_y = int(vertical_spacing*6+height/40)
    start_x = int(mid_spacing*20 + width/40)
    
    back_box = [0,0,top_spacing,vertical_spacing*6,WHITE,border,screen]
    host_box = [top_spacing,0,top_spacing*4,vertical_spacing*6,WHITE,border,screen]
    load_box = [top_spacing*5,0,top_spacing*4,vertical_spacing*6,WHITE,border,screen]
    black_box = [0,0,start_x,height,BLACK,border,screen]

    x,y = mouse_pos()
    
    inside_back_box = grey_outline(x,y,back_box,hover_colour)
    
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            crucial[6] = True
        elif event.type == pygame.KEYDOWN:
            key = pygame.key.name(event.key)
            if key == "f11":
                crucial[8] = not crucial[8]
                crucial[1],crucial[9] = crucial[9],crucial[1]
                crucial[2],crucial[10] = crucial[10],crucial[2]
                if crucial[8] == True:
                    screen = pygame.display.set_mode((crucial[1],crucial[2]),pygame.FULLSCREEN)
                else:
                    screen = pygame.display.set_mode((crucial[1],crucial[2]))

    if crucial[16] == True:
        screen.fill(BLACK)
        draw_map(crucial, maps, screen, start_x, start_y, size)
    else:
        draw_box(black_box,False,0)

    print (back_box)
    draw_box(back_box,False,0)
    draw_box(host_box,True,LIGHT_GREY)
    draw_box(load_box,False,0)

    fps(clock,crucial)
    pygame.display.flip()
    clock.tick(60)
    
    return crucial

#def box_grid(number,start_x,start_y,width,height,space,colour,border,screen):

def build_map(screen,clock,crucial,maps,build_info):
    width = crucial[1]
    height = crucial[2]
    border = crucial[3]
    spacing = int(height/((build_map_no_of_first_boxes+1)*3))
    no_of_rows = len(maps[crucial[5]])-1
    start_y = int(height/40)
    start_x = int(width/2 - height/20*19/2)
    size = int(height/20*19)
    remainder = width-size-start_x
    right_spacing = remainder/9
    
    scroll_box_size = int(height/20)
    vertical_spacing = int(height/(12.5+3*build_map_no_of_third_boxes))
    indent = int(start_x+size+right_spacing)
    
    if build_info[1] == True:
        build_info[2] = copy.deepcopy(maps[crucial[5]])
        build_info[1] = False
    
    first_row_boxes = box_grid(build_map_no_of_first_boxes,int(start_x/(7)*2),int(height/40),spacing*2,spacing*2,spacing,box_colour,int(border/2),screen)
    second_row_boxes = box_grid(build_map_no_of_first_boxes,int(start_x/(7))*4,int(height/40),spacing*2,spacing*2,spacing,box_colour,int(border/2),screen)
    third_row_boxes = box_grid(build_map_no_of_third_boxes,indent,vertical_spacing*10,right_spacing*6,vertical_spacing*2,vertical_spacing,box_colour,int(border/2),screen)
    fourth_row_boxes = box_grid(build_map_no_of_third_boxes,indent+int(right_spacing*6.5),vertical_spacing*10,right_spacing,vertical_spacing*2,vertical_spacing,box_colour,int(border/2),screen)
    clear_box = [int(start_x/7*2),build_map_no_of_first_boxes*(spacing*3+1),spacing*2+2*int(start_x/(7)),spacing*2,box_colour,int(border/2),screen]
    quit_box = [int(start_x+size+right_spacing*5),vertical_spacing*(10+3*build_map_no_of_third_boxes),right_spacing*3,int(vertical_spacing*1.5),box_colour,int(border/2),screen]
    save_box = [int(start_x+size+right_spacing),vertical_spacing*(10+3*build_map_no_of_third_boxes),right_spacing*3,int(vertical_spacing*1.5),box_colour,int(border/2),screen]
    add_box = [int(width-2*right_spacing),vertical_spacing*7,vertical_spacing*2,vertical_spacing*2,box_colour,int(border/2),screen]
    remove_box = [int(start_x+size+right_spacing),vertical_spacing*7,vertical_spacing*2,vertical_spacing*2,box_colour,int(border/2),screen]
    title_box = [indent,vertical_spacing,int(right_spacing*7.5),vertical_spacing*3,box_colour,int(border/2),screen]
    size_writing_box = [indent,int(vertical_spacing*4.5),right_spacing*8,vertical_spacing*2,box_colour,int(border/2),screen]
    size_box = [int(start_x+size+right_spacing*3),vertical_spacing*7,right_spacing*3,right_spacing,box_colour,int(border/2),screen]
    scroll_up_box = [start_x,start_y,size,scroll_box_size,box_colour,int(border/2),screen]
    scroll_down_box = [start_x,start_y+size-scroll_box_size,size,scroll_box_size,box_colour,int(border/2),screen]
    scroll_left_box = [start_x,start_y,scroll_box_size,size,box_colour,int(border/2),screen]
    scroll_right_box = [start_x+size-scroll_box_size,start_y,scroll_box_size,size,box_colour,int(border/2),screen]
    scroll_boxes = [scroll_up_box,scroll_down_box,scroll_left_box,scroll_right_box]
    black_left = [0,0,start_x,height,BLACK,0,screen]
    black_right = [start_x+size,0,remainder,height,BLACK,0,screen]

    #box = [x,y,width,height,colour,border,screen]
    #number_of_each_base = [0,0,0,0]
    if crucial[16] == True:
        number_of_bases = 0
        check_point_count = 0
        money_point_count = 0
        blank_count = 0
        for i in range(4):
            number = 0
            for j in range(no_of_rows):
                number += maps[crucial[5]][j].count(i+1)
                check_point_count += maps[crucial[5]][j].count(i+values_before + 6)
                money_point_count += maps[crucial[5]][j].count(i+values_before + 1)
            if number > 0:
                number_of_bases += 1

        for i in range(no_of_rows):
            check_point_count += maps[crucial[5]][i].count(values_before+5)
            money_point_count += maps[crucial[5]][i].count(values_before)
            blank_count += maps[crucial[5]][i].count(0)

        build_info[5] = [x for x in range(build_map_no_of_third_boxes)]
        build_info[5][0] = number_of_bases
        build_info[5][1] = check_point_count
        build_info[5][2] = money_point_count
        build_info[5][3] = blank_count

        screen.fill(BLACK)
        crucial[17] = draw_map(crucial,maps,screen,start_x,start_y,size)

        crucial[16] = False
        
    else:
        draw_box(black_right,False,0)
        draw_box(black_left,False,0)

    x,y = mouse_pos()

    if crucial[7] == True:
        inside_map = inside_box(x,y,[start_x,start_y,size,size,WHITE,0,screen])
        if inside_map == True:
            x_coord = x-start_x
            y_coord = y-start_y
            x_coord = int(x_coord/(crucial[17]+gap))
            y_coord = int(y_coord/(crucial[17]+gap))
            try:
                maps[crucial[5]][x_coord+crucial[13]][y_coord+crucial[12]] = build_info[0]
                crucial[16] = True
            except:
                data = 0

    inside_col_1 = []
    inside_col_2 = []

    in_a_box = False

    if build_info[0] > values_before  and build_info[0] < values_before + 5:
        value = values_before
        excess_value = build_info[0] - values_before
    elif build_info[0] > values_before + 5 and build_info[0] < values_before + 10:
        value = values_before + 5
        excess_value = build_info[0] - values_before - 5
    else:
        value = build_info[0]
        excess_value = -1
    
    for i in range(build_map_no_of_first_boxes):
        inside_col_1.append(False)
        inside_col_1[i] = inside_box(x,y,first_row_boxes[i])
        inside_col_2.append(False)
        inside_col_2[i] = inside_box(x,y,second_row_boxes[i])
        if inside_col_1[i] == True:
            in_a_box = True
            first_row_boxes[i][4] = hover_colour
        elif inside_col_2[i] == True:
            second_row_boxes[i][4] = hover_colour
            in_a_box = True
        if value == build_map_colours_for_first[i] or excess_value == build_map_colours_for_first[i]:
            first_row_boxes[i][4] = clicked_colour
        if value == build_map_colours_for_second[i] or excess_value == build_map_colours_for_second[i]:
            second_row_boxes[i][4] = clicked_colour
    
    inside_title_box = inside_box(x,y,title_box)
    
    crucial = scrolling(crucial,scroll_boxes,x,y)

    inside_add_box = grey_outline(x,y,add_box,hover_colour)
    inside_remove_box = grey_outline(x,y,remove_box,hover_colour)
    inside_clear_box = grey_outline(x,y,clear_box,hover_colour)
    inside_save_box = grey_outline(x,y,save_box,hover_colour)
    inside_quit_box = grey_outline(x,y,quit_box,hover_colour)
    
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            crucial[6] = True
        elif event.type == pygame.KEYDOWN:
            key = pygame.key.name(event.key)
            if key == "f11":
                crucial[8] = not crucial[8]
                crucial[1],crucial[9] = crucial[9],crucial[1]
                crucial[2],crucial[10] = crucial[10],crucial[2]
                if crucial[8] == True:
                    screen = pygame.display.set_mode((crucial[1],crucial[2]),pygame.FULLSCREEN)
                else:
                    screen = pygame.display.set_mode((crucial[1],crucial[2]))
            elif key == "right":
                build_ino = arrow_keys(build_info,1,OBSTACLE,DOOR,values_before + 10,0)
            elif key == "left":
                build_info = arrow_keys(build_info,-1,DOOR,OBSTACLE,-1,values_before+9)
            elif key == "return":
                maps,crucial = clear_box_button(maps,crucial,build_info)
        elif event.type == pygame.MOUSEBUTTONDOWN:
            if event.button == 1:
                crucial[7] = True
                build_info[3] = False
                if in_a_box == True:
                    for i in range(len(inside_col_1)):
                        if inside_col_1[i] == True:
                            if build_info[0] == values_before or build_info[0] == values_before + 5:
                                if build_map_colours_for_first[i] > 0 and build_map_colours_for_first[i] < 5:
                                    build_info[0] += build_map_colours_for_first[i]
                                else:
                                    build_info[0] = build_map_colours_for_first[i]
                            else:
                                build_info[0] = build_map_colours_for_first[i]
                        if inside_col_2[i] == True:
                            if build_info[0] == values_before or build_info[0] == values_before + 5:
                                if build_map_colours_for_second[i] > 0 and build_map_colours_for_second[i] < 5:
                                    build_info[0] += build_map_colours_for_second[i]
                                else:
                                    build_info[0] = build_map_colours_for_second[i]
                            else:
                                build_info[0] = build_map_colours_for_second[i]
                elif inside_clear_box:
                    maps,crucial = clear_box_button(maps,crucial,build_info)
                elif inside_save_box:
                    build_info[1] = True
                    Write_file(maps)
                    crucial = zoom_reset(crucial)
                elif inside_quit_box:
                    crucial[0] = maps_menu_value
                    crucial[16] = True
                    build_info[1] = True
                    maps[crucial[5]] = build_info[2]
                    crucial = zoom_reset(crucial)
                elif inside_title_box:
                    build_info[3] = True
                elif inside_remove_box:
                    if no_of_rows > 5:
                        maps[crucial[5]].pop(no_of_rows-1)
                        crucial[16] = True
                        for i in range(no_of_rows-1):
                            maps[crucial[5]][i].pop(no_of_rows-1)
                elif inside_add_box:
                    crucial[16] = True
                    maps[crucial[5]].insert(no_of_rows,[])
                    for i in range(no_of_rows):
                        maps[crucial[5]][i].append(BLANK)
                        maps[crucial[5]][no_of_rows].append(BLANK)
                    maps[crucial[5]][no_of_rows].append(BLANK)
            else:
                crucial = mouse_scrolling(crucial,event,no_of_rows)
                
        elif event.type == pygame.MOUSEBUTTONUP:
            if event.button == 1:
                crucial[7] = False
        if build_info[3] == True:
             maps[crucial[5]][len(maps[crucial[5]])-1],crucial[4] = letters(maps[crucial[5]][len(maps[crucial[5]])-1],crucial[4],event)

    #box = [x,y,width,height,colour,border,screen]

    for i in range(build_map_no_of_first_boxes):
        
        draw_box(first_row_boxes[i],True,build_map_colours_for_first[i])
        if build_map_colours_for_first[i] == 9:
            copy_box = [first_row_boxes[i][0]+spacing*2-int(first_row_boxes[i][2]/wall_width),first_row_boxes[i][1],int(spacing*2/wall_width),spacing*2,window_colour,0,screen]
            draw_box(copy_box,False,0)
            draw_box(first_row_boxes[i],False,build_map_colours_for_first[i])
        elif build_map_colours_for_first[i] > 9 and build_map_colours_for_first[i] < 15:
            write("£",BLACK,first_row_boxes[i],True)
        elif build_map_colours_for_first[i] > 14 and build_map_colours_for_first[i] < 20:
            write("!",BLACK,first_row_boxes[i],True)

        draw_box(second_row_boxes[i],True,build_map_colours_for_second[i])
        if build_map_colours_for_second[i] == 9:
            copy_box = [second_row_boxes[i][0]+spacing*2-int(second_row_boxes[i][2]/wall_width),second_row_boxes[i][1],int(spacing*2/wall_width),spacing*2,window_colour,0,screen]
            draw_box(copy_box,False,0)
            draw_box(second_row_boxes[i],False,build_map_colours_for_second[i])
        elif build_map_colours_for_second[i] > 9 and build_map_colours_for_second[i] < 15:
            write("£",BLACK,second_row_boxes[i],True)
        elif build_map_colours_for_second[i] > 14 and build_map_colours_for_second[i] < 20:
            write("!",BLACK,second_row_boxes[i],True)

    font_size = 0
    for i in range(build_map_no_of_third_boxes):
        i = build_map_no_of_third_boxes-1-i
        write(str(build_info[5][i]),WHITE,fourth_row_boxes[i],True)
        font_size = write(build_map_text_for_third_boxes[i],WHITE,third_row_boxes[i],False,1,font_size)
        
    draw_box(clear_box,True,build_info[0])
    draw_box(save_box,True,WHITE)
    draw_box(quit_box,True,WHITE)
    draw_box(add_box,True,WHITE)
    draw_box(remove_box,True,WHITE)

    write(maps[crucial[5]][len(maps[crucial[5]])-1],WHITE,title_box,False)
    write("QUIT",BLACK,quit_box,True)
    write("SAVE",BLACK,save_box,True)
    write("SIZE",WHITE,size_writing_box,False)
    write("+",BLACK,add_box,True,1.25)
    write("-",BLACK,remove_box,True,1.1)
    write(str(no_of_rows),WHITE,size_box,True,0.8)

    fps(clock,crucial)
    pygame.display.flip()
    clock.tick(60)
    
    return crucial,build_info,maps
    
def main():
    width = 1400
    height = 700
    border = int(width/200) 
    
    screen = pygame.display.set_mode((width,height))
    clock = pygame.time.Clock()

    pygame.display.set_caption("Map Builder")

    maps = load_maps()
    maps_updated = False
    done = False
    holding = False
    hello =0
    previous_time = 0
    fullscreen = False
    fullscreen_width = 1900
    fullscreen_height = 1000
    scroll = 0
    push_down = 0
    push_right = 0
    scroll_time = 0
    FPS_BOX = [0,0,60,20,BLACK,border,screen]
    map_edited = True
    square_size = 0

    crucial = [main_menu_value,width,height,border,previous_time,0,done,holding,fullscreen,fullscreen_width,fullscreen_height,scroll,push_down,push_right,scroll_time,FPS_BOX,map_edited,square_size]

    #crucial[0] = game mode
    #crucial[1] = width
    #crucial[2] = height
    #crucial[3] = border
    #crucial[4] = previous_time
    #crucial[5] = map_drawn
    #crucial[6] = done
    #crucial[7] = holding
    #crucial[8] = fullscreen
    #crucial[9] = fullscreen_width
    #crucial[10] = fullscreen_height
    #crucial[11] = scroll
    #crucial[12] = push_down
    #crucial[13] = push_right
    #crucial[14] = scroll_time
    #crucial[15] = FPS_BOX
    #crucial[16] = map_edited
    #crucial[17] = square_size
    
    colour_click = 0
    just_loaded = True
    original_grid = [[0,0],[0,0]]
    editing_title = False
    mid_way = False
    text_for_fourth_row_boxes = []

    build_info = [colour_click,just_loaded,original_grid,editing_title,mid_way,text_for_fourth_row_boxes]

    #build_info[0] = colour_click
    #build_info[1] = just_loaded
    #build_info[2] = original_grid
    #build_info[3] = editing_title
    #build_info[4] = mid_way
    #build_info[5] = text_for_fourth_row_boxes
    
    while crucial[6] == False:
        if crucial[0] == main_menu_value:
            crucial = main_menu(screen,clock,crucial)
        elif crucial[0] == maps_menu_value:
            crucial = maps_menu(screen,clock,crucial,maps)
        elif crucial[0] == build_maps_value:
            crucial,build_info,maps = build_map(screen,clock,crucial,maps,build_info)
        elif crucial[0] == game_set_up_value:
            crucial = game_set_up(screen,clock,crucial,maps)
        elif crucial[0] == game_load_value:
            crucial = game_load(screen,clock,crucial)
                
    
    Write_file(maps)
    
    pygame.quit()

if __name__ == "__main__":
    main()
