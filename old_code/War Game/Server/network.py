import socket
import pickle

class Network:
    def __init__(self):
        self.client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server = "192.168.1.119"
        self.port = 5555
        self.addr = (self.server, self.port)
        self.connected = False

    def getP(self):
        return self.p

    def connect(self):
        try:
            self.client.connect(self.addr)
            self.p = self.client.recv(2048).decode()
            self.connected = True
        except:
            self.p = "No Connection"

    def send(self, data):
        try:
            self.client.send(str.encode(data))
            return pickle.loads(self.client.recv(2048*2))
        except socket.error as e:
            print(e)
            
    def finish(self):
        try:
            self.client.send(str.encode("finish"))
        except:
            print("Failed to Quit")

