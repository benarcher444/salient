import threading
import time

def fun():
    time.sleep(2)
    
x = threading.Thread(target = fun)

x.start()

print(threading.active_count())
time.sleep(2)

print(threading.active_count())

