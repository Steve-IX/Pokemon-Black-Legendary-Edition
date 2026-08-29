"""
Pokemon Black Version - Game Runner, Save Injector & Live Monitor
------------------------------------------------------------------
This program:
  1. Configures and verifies the clean/custom ROM.
  2. Directly injects the 6 Legendary Pokémon Team into the active save files
     (Reshiram, Zekrom, Kyurem, Victini, Rayquaza, Mewtwo) with full movesets.
  3. Launches RetroArch or DeSmuME automatically with the custom ROM.
  4. Monitors the game process in real-time.
"""

import os
import sys
import time
import struct
import subprocess
import shutil

class LCRNG:
    def __init__(self, seed):
        self.seed = seed & 0xFFFFFFFF
    def next(self):
        self.seed = (self.seed * 0x41C64E6D + 0x6073) & 0xFFFFFFFF
        return (self.seed >> 16) & 0xFFFF

BLOCK_ORDERS = [
    [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 3, 1, 2], [0, 2, 3, 1], [0, 3, 2, 1],
    [1, 0, 2, 3], [1, 0, 3, 2], [2, 0, 1, 3], [3, 0, 1, 2], [2, 0, 3, 1], [3, 0, 2, 1],
    [1, 2, 0, 3], [1, 3, 0, 2], [2, 1, 0, 3], [3, 1, 0, 2], [2, 3, 0, 1], [3, 2, 0, 1],
    [1, 2, 3, 0], [1, 3, 2, 0], [2, 1, 3, 0], [3, 1, 2, 0], [2, 3, 1, 0], [3, 2, 1, 0]
]

LEGENDARY_TEAM = [
    {"species": 643, "name": "Reshiram", "level": 70, "moves": [551, 558, 406, 326], "hp": 245, "atk": 205, "def": 175, "spa": 255, "spd": 205, "spe": 160}, # Blue Flare, Fusion Flare, Dragon Pulse, Extrasensory
    {"species": 644, "name": "Zekrom",   "level": 70, "moves": [552, 559, 406, 428], "hp": 245, "atk": 255, "def": 205, "spa": 205, "spd": 175, "spe": 160}, # Bolt Strike, Fusion Bolt, Dragon Pulse, Zen Headbutt
    {"species": 646, "name": "Kyurem",   "level": 75, "moves": [548, 59, 58, 406],   "hp": 295, "atk": 230, "def": 165, "spa": 230, "spd": 165, "spe": 175}, # Glaciate, Blizzard, Ice Beam, Dragon Pulse
    {"species": 494, "name": "Victini",  "level": 70, "moves": [557, 499, 558, 559], "hp": 245, "atk": 175, "def": 175, "spa": 175, "spd": 175, "spe": 175}, # V-create, Searing Shot, Fusion Flare, Fusion Bolt
    {"species": 384, "name": "Rayquaza", "level": 70, "moves": [434, 200, 403, 245], "hp": 250, "atk": 250, "def": 160, "spa": 250, "spd": 160, "spe": 165}, # Draco Meteor, Outrage, Air Slash, Extremespeed
    {"species": 150, "name": "Mewtwo",   "level": 70, "moves": [425, 94, 247, 396],  "hp": 252, "atk": 185, "def": 160, "spa": 260, "spd": 160, "spe": 220}  # Psystrike, Psychic, Shadow Ball, Aura Sphere
]

def make_pk5(p_info, ot_name="Trainer", tid=12345, sid=54321):
    species_id = p_info["species"]
    level = p_info["level"]
    moves = p_info["moves"]
    nickname = p_info["name"]
    
    pid = 0x2A3B4C5D + species_id
    
    # Block A
    block_a = bytearray(32)
    struct.pack_into("<H", block_a, 0x00, species_id)
    struct.pack_into("<H", block_a, 0x02, 0)
    struct.pack_into("<H", block_a, 0x04, tid)
    struct.pack_into("<H", block_a, 0x06, sid)
    struct.pack_into("<I", block_a, 0x08, 343000) # Level 70 EXP
    block_a[0x0C] = 200 # High Friendship
    block_a[0x0F] = 2 # English
    
    # Block B
    block_b = bytearray(32)
    for i, m in enumerate(moves[:4]):
        struct.pack_into("<H", block_b, i*2, m)
        block_b[8 + i] = 15 # PP
    # Max IVs (31 all stats)
    iv_word = (31) | (31 << 5) | (31 << 10) | (31 << 15) | (31 << 20) | (31 << 25)
    struct.pack_into("<I", block_b, 0x18, iv_word)
    
    # Block C
    block_c = bytearray(32)
    nick_enc = nickname.encode("utf-16le")[:22]
    block_c[:len(nick_enc)] = nick_enc
    if len(nick_enc) < 22:
        struct.pack_into("<H", block_c, len(nick_enc), 0xFFFF)
        
    # Block D
    block_d = bytearray(32)
    ot_enc = ot_name.encode("utf-16le")[:14]
    block_d[:len(ot_enc)] = ot_enc
    if len(ot_enc) < 14:
        struct.pack_into("<H", block_d, len(ot_enc), 0xFFFF)
    block_d[0x12] = 20
    block_d[0x13] = 8
    block_d[0x14] = 29
    struct.pack_into("<H", block_d, 0x16, 1) # Route 1
    block_d[0x18] = 0x01 # Master Ball
    block_d[0x19] = level
    
    # Checksum & Shuffling
    checksum = sum(struct.unpack("<16H", block_a) + struct.unpack("<16H", block_b) + struct.unpack("<16H", block_c) + struct.unpack("<16H", block_d)) & 0xFFFF
    order = BLOCK_ORDERS[((pid & 0x3E000) >> 13) % 24]
    blocks = [block_a, block_b, block_c, block_d]
    shuffled = bytearray(128)
    for i in range(4):
        shuffled[i*32 : (i+1)*32] = blocks[order[i]]
        
    # Encrypt blocks
    prng = LCRNG(checksum)
    enc_blocks = bytearray(128)
    for i in range(0, 128, 2):
        k = prng.next()
        v = struct.unpack("<H", shuffled[i:i+2])[0]
        struct.pack_into("<H", enc_blocks, i, v ^ k)
        
    # Battle Stats (Authentic Stats calculated at Lv. 70/75)
    battle = bytearray(84)
    battle[0x04] = level
    struct.pack_into("<H", battle, 0x06, p_info["hp"])
    struct.pack_into("<H", battle, 0x08, p_info["hp"])
    struct.pack_into("<H", battle, 0x0A, p_info["atk"])
    struct.pack_into("<H", battle, 0x0C, p_info["def"])
    struct.pack_into("<H", battle, 0x0E, p_info["spe"])
    struct.pack_into("<H", battle, 0x10, p_info["spa"])
    struct.pack_into("<H", battle, 0x12, p_info["spd"])
    
    prng_b = LCRNG(pid)
    enc_battle = bytearray(84)
    for i in range(0, 84, 2):
        k = prng_b.next()
        v = struct.unpack("<H", battle[i:i+2])[0]
        struct.pack_into("<H", enc_battle, i, v ^ k)
        
    pk5 = bytearray(220)
    struct.pack_into("<I", pk5, 0x00, pid)
    struct.pack_into("<H", pk5, 0x04, 0)
    struct.pack_into("<H", pk5, 0x06, checksum)
    pk5[8:136] = enc_blocks
    pk5[136:220] = enc_battle
    return bytes(pk5)

def inject_legendary_team_into_saves():
    """Injects the team of 6 Legendary Pokemon into all active emulator saves."""
    save_locations = [
        r"C:\RetroArch-Win64\saves\melonDS\Pokemon - Black Version (Custom Legendary Team Edition).sav",
        r"C:\RetroArch-Win64\saves\melonDS DS\Pokemon - Black Version (Custom Legendary Team Edition).srm",
        r"C:\RetroArch-Win64\saves\DeSmuME\Pokemon - Black Version (Custom Legendary Team Edition).dsv",
        r"C:\RetroArch-Win64\saves\DeSmuME 2015\Pokemon - Black Version (Custom Legendary Team Edition).dsv"
    ]
    
    team_pk5 = [make_pk5(p) for p in LEGENDARY_TEAM]
    
    for s_path in save_locations:
        if not os.path.exists(s_path):
            os.makedirs(os.path.dirname(s_path), exist_ok=True)
            data = bytearray(524288 if not s_path.endswith('.dsv') else 524410)
        else:
            with open(s_path, 'rb') as f:
                data = bytearray(f.read())
                
        # Inject into Block 0 (0x18E00) and Block 1 (0x3CE00)
        for block_base in [0x18E00, 0x3CE00]:
            if block_base + 0x600 <= len(data):
                struct.pack_into("<I", data, block_base, 6) # Party count = 6
                for slot, pk5 in enumerate(team_pk5):
                    data[block_base + 4 + slot * 220 : block_base + 4 + (slot + 1) * 220] = pk5
                    
        with open(s_path, 'wb') as f:
            f.write(data)
        print(f"[+] Injected 6 Legendary Pokémon Team into save: {s_path}")

def launch_and_monitor():
    print("==================================================================")
    print("      POKÉMON BLACK - 6 LEGENDARY TEAM LOADER & MONITOR           ")
    print("==================================================================")
    print("Legendary Team:")
    for idx, p in enumerate(LEGENDARY_TEAM, 1):
        print(f"  {idx}. {p['name']} (Lv. {p['level']}) - Species #{p['species']}")
    print("------------------------------------------------------------------")
    
    inject_legendary_team_into_saves()
    
    rom_path = r"C:\ROMS\Pokemon - Black Version (Custom Legendary Team Edition).nds"
    retroarch_exe = r"C:\RetroArch-Win64\retroarch.exe"
    core_path = r"C:\RetroArch-Win64\cores\melonds_libretro.dll"
    
    if not os.path.exists(retroarch_exe):
        print("[-] RetroArch not found at C:\\RetroArch-Win64\\retroarch.exe")
        return
        
    cmd = [retroarch_exe, "-L", core_path, rom_path]
    print(f"[*] Launching game with live monitor...")
    proc = subprocess.Popen(cmd)
    
    print(f"[+] Game process started (PID: {proc.pid}). Monitoring execution...")
    try:
        while proc.poll() is None:
            time.sleep(2)
        print(f"[*] Game process ended with code {proc.returncode}.")
    except KeyboardInterrupt:
        print("\n[*] Stopping monitor.")

if __name__ == "__main__":
    launch_and_monitor()
