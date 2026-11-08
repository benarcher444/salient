# -*- coding: utf-8 -*-
"""
Created on Wed Oct 27 00:17:42 2021

@author: Ben Archer
"""

from network import Network

network = Network()
print("start")
player = network.id

reply = network.send("host")
print(reply)