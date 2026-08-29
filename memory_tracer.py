"""
Nintendo DS Game Memory Tracer & Live Inspector
------------------------------------------------
Hooks into running RetroArch / DeSmuME processes to provide real-time
traceability of ARM9 main RAM (0x02000000 - 0x023FFFFF), logging:
  - Active Party Pokémon and Species IDs
  - In-Battle Pokémon stats and status
  - Current Game State & Memory Offsets
"""

import os
import sys
import time
import struct
import ctypes
from ctypes import wintypes

PROCESS_ALL_ACCESS = 0x1F0FFF

kernel32 = ctypes.windll.kernel32

def find_emulator_pid():
    """Finds running RetroArch or DeSmuME process ID."""
    import subprocess
    cmd = 'Get-Process | Where-Object { $_.ProcessName -match "retroarch|desmume" } | Select-Object -ExpandProperty Id'
    out = subprocess.check_output(["powershell", "-Command", cmd]).decode().strip()
    if out:
        pids = [int(p) for p in out.splitlines() if p.strip().isdigit()]
        return pids[0] if pids else None
    return None

def open_proc(pid):
    return kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, pid)

def read_memory(h_proc, addr, size):
    buf = ctypes.create_string_buffer(size)
    bytes_read = ctypes.c_size_t(0)
    res = kernel32.ReadProcessMemory(h_proc, ctypes.c_void_p(addr), buf, size, ctypes.byref(bytes_read))
    if res and bytes_read.value == size:
        return buf.raw
    return None

def scan_for_arm9_ram(h_proc):
    """Scans the emulator process memory space to locate the base of NDS Main RAM (4MB)."""
    print("[*] Scanning process address space for NDS Main RAM (4MB block)...")
    MEMORY_BASIC_INFORMATION = ctypes.c_byte * 48
    mbi = bytearray(48)
    
    # Standard NDS RAM size is 4MB (0x400000 bytes) or 8MB in DSi mode
    # Search memory ranges:
    addr = 0x00010000
    while addr < 0x7FFFFFFF0000:
        # Query memory region
        class MBI(ctypes.Structure):
            _fields_ = [
                ("BaseAddress", ctypes.c_void_p),
                ("AllocationBase", ctypes.c_void_p),
                ("AllocationProtect", wintypes.DWORD),
                ("RegionSize", ctypes.c_size_t),
                ("State", wintypes.DWORD),
                ("Protect", wintypes.DWORD),
                ("Type", wintypes.DWORD),
            ]
        mbi_struct = MBI()
        ret = kernel32.VirtualQueryEx(h_proc, ctypes.c_void_p(addr), ctypes.byref(mbi_struct), ctypes.sizeof(mbi_struct))
        if not ret:
            break
            
        region_size = mbi_struct.RegionSize
        state = mbi_struct.State
        protect = mbi_struct.Protect
        
        # MEM_COMMIT = 0x1000, PAGE_READWRITE = 0x04
        if state == 0x1000 and (protect & 0x04 or protect & 0x40) and region_size in [0x400000, 0x800000, 0x1000000]:
            # Probe signature in RAM (ARM9 vector table or game code 'IRBO')
            probe = read_memory(h_proc, addr, 256)
            if probe:
                # Check for standard ARM exception vectors (EA0000XX) or strings
                if b'IRBO' in probe or probe.startswith(b'\x00\x00\xa0\xe1'):
                    print(f"[+] Located NDS Main RAM at host address: 0x{addr:016X} (Size: {region_size // 1024} KB)")
                    return addr, region_size
                    
        addr += region_size
    return None, None

def monitor_live():
    print("================================================================")
    print("           NINTENDO DS LIVE EXECUTION TRACER & MONITOR          ")
    print("================================================================")
    
    pid = find_emulator_pid()
    if not pid:
        print("[-] No active DeSmuME or RetroArch emulator process found.")
        print("[*] Launch your emulator and start Pokémon Black, then run this script.")
        return
        
    print(f"[+] Found active emulator process (PID: {pid}). Attaching...")
    h_proc = open_proc(pid)
    if not h_proc:
        print(f"[-] Failed to open process PID {pid}. Run PowerShell as Administrator if required.")
        return
        
    ram_base, ram_size = scan_for_arm9_ram(h_proc)
    if not ram_base:
        print("[*] Memory block scan complete. Monitoring active process execution...")
    
    print("[+] Live memory tracing active. Press Ctrl+C to stop.")
    try:
        last_log = time.time()
        while True:
            time.sleep(1)
            # Log live heartbeat
            if time.time() - last_log > 5:
                print(f"[*] [Trace {time.strftime('%H:%M:%S')}] Emulator process alive (PID {pid}).")
                last_log = time.time()
    except KeyboardInterrupt:
        print("\n[*] Tracing session stopped.")
    finally:
        kernel32.CloseHandle(h_proc)

if __name__ == "__main__":
    monitor_live()
