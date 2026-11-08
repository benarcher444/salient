# -*- coding: utf-8 -*-
"""
Created on Thu Dec 16 03:16:40 2021

@author: Ben Archer
"""

import threading
import time

def func():
    time.sleep(1)
    print("yo")
    
x = threading.Thread(target = func)

x.start()
print("hey")
