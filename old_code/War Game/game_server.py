import socket
from _thread import start_new_thread
from player_info import Player_Info
import pickle
import time

server = "192.168.1.119"
port = 5555

my_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

try:
    my_socket.bind((server, port))
except socket.error as error:
    print(str(error))
    
my_socket.listen(1)
print("Waiting for a Connection, Server Started")

running = True
connected = dict()
clients = []
host_connected = False
setup_finished = False
game_started = False
map_choice = None
max_players = 4
no_players = 0
units = dict()

def host(conn, addr):
    global running
    global host_connected
    global setup_finished
    global game_started
    global map_choice
    global max_players
    global connected
    global units
    global no_players

    done = False
    
    print(connected)
    
    player = connected[addr]
    
    try:
        data = pickle.loads(conn.recv(4096*100))
    except:
        data = [None]
        done = True
    
    if game_started == False:
        if data[0] == "hosting":
            if host_connected == False:
                player.player_type = "hosting"
                map_choice = data[1]
                host_connected = True
            else:
                player.player_type = "Host Already Present"
                done = True
                
        elif data[0] == "joining":
            if host_connected == False:
                player.player_type = "No Host Present"
                done = True
            elif len(connected) > max_players:
                player.player_type = "Maximum Player Count Reached"
                done = True
            else:
                if setup_finished == True:
                    player.player_type = "joining"
                else:
                    player.player_type = "The Host Is Setting Up The Game"
                    done = True
        else:
            player.player_type = "Invalid Join Request"
            done = True
    else:
        player.player_type = "Game Already In Session"
        done = True
        
    conn.sendall(pickle.dumps(["set up", addr, connected, map_choice]))
    send_to_all(["connected", connected])
    
    conn.settimeout(5)
    
    reserve_data = None
    
    while (not done) & running:
        try:
            if reserve_data == None:
                data = pickle.loads(conn.recv(4096*100))
            else:
                data = reserve_data
                reserve_data = None
            
            if data[0] == "finish":
                print("Received Finish")
                done = True
            
            elif data[0] == "setup":
                print("Received Setup")
                map_choice = data[1]
                max_players = data[2]
                connected = data[3]
                setup_finished = True
                
            elif data[0] == "connected":
                print("Received Connected")
                connected = data[1]
                send_to_all(["connected", connected])
                
            elif data[0] == "create game":
                print("Received Game Start")
                game_started = True
                no_players = len(connected)
                send_to_all(["create game"])
                
            elif data[0] == "units":
                print("Received Units")
                units[connected[addr].player_colour] = data[1]
                
                if len(units) == no_players:
                    sort_units(units)
                    units = dict()
            
            else:
                print("Unexpected Data: ", data[0])
            
        except socket.timeout:
            print("Sending Ping to: ", addr)
            send(conn, ["ping"])
            try:
                data = pickle.loads(conn.recv(4096*100))
                if data[0] != "ping":
                    print("Potential Error: ", data[0])
                    reserve_data = data
            except:
                done = True
                
    if connected[addr].player_type == "done setup":
        change_host = True
    else:
        change_host = False

    print("Lost connection")
    del connected[addr]
    clients.remove(conn)
    
    if len(connected) == 0:
        setup_finished = False
        map_choice = None
        host_connected = False
        max_players = 4
        game_started = False
        units = dict()
        
    else:
        if change_host:
            list(connected.values())[0].player_type = "done setup"
            
    send_to_all(["connected", connected])
    
    conn.close()
    
def sort_units(units):
    new_units = []
    alive_units = []
    for (team, unit_set) in units.items():
        for unit in unit_set:
            if unit.team == team:
                new_units.append(unit)
    
    for i, unit in enumerate(new_units):
        total_damage = 0
        for unit_set in units.values():
            for old_unit in unit_set:
                if (unit.team == old_unit.team) & (unit.id == old_unit.id):
                    total_damage += old_unit.damage_taken
        unit.health = max(0, unit.health - total_damage)
        
        dead = unit.end_turn()
        
        if not dead:
            alive_units.append(unit)    
    
    for unit in alive_units:
        if len(unit.squares) == 1:
            for command_post in map_choice.command_posts:
                if (list(unit.squares)[0][0] == command_post.x) & (list(unit.squares)[0][1] == command_post.y):
                    if command_post.team == None:
                        command_post.team = unit.team
                    elif command_post.team != unit.team:
                        command_post.team = None
            print(command_post.team)
        
    
    print("Sending Back Units")
    send_to_all(["units", alive_units, map_choice.command_posts])
            
    
def send(conn, data):
    try:
        conn.sendall(pickle.dumps(data))
    except ConnectionResetError:
        print("Connection Reset")
    
def send_to_all(data):
    for client in clients:
        client.send(pickle.dumps(data))
        
def send_to_others(data, conn):
    for client in clients:
        if client != conn:
            client.send(pickle.dumps(data))

while running:
    try:
        conn, addr = my_socket.accept()
        player = Player_Info(len(connected))
        connected[addr] = player
        clients.append(conn)
        print("Connected to:", addr)
        start_new_thread(host, (conn, addr))
    
    except KeyboardInterrupt:
        running = False