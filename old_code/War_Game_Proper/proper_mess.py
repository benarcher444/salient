import sys, pygame
import math
import random
import time


RED = [255,000,000]
GREEN = [000,255,000]
WHITE = [255,255,255]
BLACK = [000,000,000]

def write(text,colour,detes,centre):
    fit = False
    fraction = 1
    while fit == False:
        font_size = int(fraction*3*detes[3]/2)
        myfont = pygame.font.SysFont(None,font_size)
        mytext = myfont.render(text, 1, colour)
        txt_width,txt_height = myfont.size(text)
        if txt_width > detes[2]:
            fraction = fraction - 0.05
        else:
            fit = True
    start_x = int(detes[0]+detes[2]/2-txt_width/2)
    start_y = int(detes[1]+detes[3]/2-txt_height/2)
    
    screen = detes[6]

    detes = [start_x,start_y,txt_width,txt_height,RED,0,screen]

    draw_box(detes,False,0)
    
    if centre == True:
        detes[6].blit(mytext,(int(detes[0]+detes[2]/2-txt_width/2),int(detes[1]+detes[3]/2-txt_height/2)))
    else:
        detes[6].blit(mytext,(int(detes[0]+detes[5]),int(detes[1]+detes[3]/2-txt_height/2)))

    #print (int(detes[0]+detes[2]/2-txt_width/2))
    #print (int(detes[1]+detes[3]/2-txt_height/2))

    

    return txt_height,font_size
    

def draw_box(detes,fill,value):
    if fill == True:
        colour = colour_setter(value)
        pygame.draw.rect(detes[6],colour,(detes[0],detes[1],detes[2],detes[3]))
    pygame.draw.rect(detes[6],detes[4],(detes[0],detes[1],detes[2],detes[3]),detes[5])



    

def main():

    done = False
    size = (800, 800)
    screen = pygame.display.set_mode(size)
    clock = pygame.time.Clock()

    pygame.font.init()

    pygame.display.set_caption("My Game")

    while not done:
        show = False
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                done = True
            elif event.type == pygame.MOUSEBUTTONDOWN:
                show = True

        screen.fill(BLACK)

        x,y = pygame.mouse.get_pos()

        pygame.draw.line(screen,WHITE,(0,400),(800,400))

        detes = (0,0,100,60,WHITE,0,screen)

        height,font_size = write("HELLO",WHITE,detes,True)

        write(str(x),WHITE,(10,10,50,50,WHITE,0,screen),True)
        write(str(y),WHITE,(70,10,50,50,WHITE,0,screen),True)

        if show == True:
            print ("x location =",x)
            print ("y location =",y)
            print ("height =",height)
            print ("font size =",font_size)
            

        pygame.display.flip()
        clock.tick(60)

    pygame.quit()

if __name__ == "__main__":
    main()
