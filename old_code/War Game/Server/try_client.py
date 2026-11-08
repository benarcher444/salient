# -*- coding: utf-8 -*-
"""
Created on Tue Oct 26 22:50:22 2021

@author: Ben Archer
"""
from network import Network

network = Network()

for i in range(5):
    print("Trying to Connect: ", i + 1)
    network.connect()
    if network.connected:
        print("Made Connection")
        break
    
if network.connected:
    network.finish()
        
print(network.p)
