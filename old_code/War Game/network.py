import socket
import pickle

class Network:
    def __init__(self):
        self.client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server = "192.168.1.119"
        self.port = 5555
        self.addr = (self.server, self.port)
        self.connected = False

    def connect(self, player_type, map_choice):
        try:
            self.client.connect(self.addr)
            self.connected = True
            self.send([player_type, map_choice])
            return pickle.loads(self.client.recv(2048*200))
        except:
            return "No Connection"

    def send(self, data):
        if self.connected == True:
            try:
                self.client.sendall(pickle.dumps(data))
            except socket.error:
                print("Socket Error")
            
    def finish(self):
        try:
            self.client.send(["finish"])
        except:
            print("Failed to Quit")
            
    def receive(self):
        try:
            data = pickle.loads(self.client.recv(2048*2000))
            return data
        except socket.error as e:
            print("socket error")
        except EOFError as e:
            print("EOFError")
