import socket
from _thread import start_new_thread
import pickle

server = "192.168.1.119"
port = 5555

my_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

try:
    my_socket.bind((server, port))
except socket.error as error:
    print(str(error))
    
my_socket.listen(4)
print("Waiting for a Connection, Server Started")

connected = []
host_connected = False

def host(conn, addr):
    global host_connected
    
    conn.send(str.encode(str(len(connected))))
    player_type = "joined"
    
    while True:
        try:
            data = conn.recv(4096).decode()
            if data == "host":
                if host_connected == False:
                    print("Host Connected")
                    player_type = "host"
                    conn.send(str.encode("host"))
                    host_connected = True
                else:
                    print("Another Player Tried to Host")
                    conn.send(str.encode("Host Already Present"))
                    break
            else:
                break
        except:
            break

    print("Lost connection")
    connected.remove(addr)
    print(connected)
    
    if player_type == "host":
        host_connected == False
    
    conn.close()

while True:
    conn, addr = my_socket.accept()
    connected.append(addr)
    print("Connected to:", addr)
    start_new_thread(host, (conn, addr))