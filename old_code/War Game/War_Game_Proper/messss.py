import pygame

BLACK = (0,0,0)

pygame.init()

width = 1400
height = 700
border = int(width/200) 
    
screen = pygame.display.set_mode((width,height))
clock = pygame.time.Clock()

pygame.display.set_caption("Map Builder")

screen.fill(BLACK)

while True:
    for event in pygame.event.get():
        if event.type == pygame.KEYDOWN:
            key = pygame.key.name(event.key)
            print (key)

    pygame.display.flip()
    clock.tick(60)

        
