import sys, pygame
import math
import random

RED = [255,000,000]
GREEN = [000,255,000]
WHITE = [255,255,255]
BLACK = [000,000,000]


def main():
    size = (800, 800)
    screen = pygame.display.set_mode(size)
    clock = pygame.time.Clock()

    pygame.display.set_caption("My Game")
        
    done = False

    pygame.init()

    while not done:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                done = True
        

        screen.fill(BLACK)

        myfont = pygame.font.SysFont(None,50)
        text = "hello"
        print(myfont.size(text))
        mytext = myfont.render('hello', 1, WHITE)
        screen.blit(mytext, (20,20))


        width = 800
        height = 800

        pygame.draw.line(screen,WHITE,[100,100],[200,100],10)


        pygame.display.flip()
        clock.tick(60)

    pygame.quit()

if __name__ == "__main__":
    main()
