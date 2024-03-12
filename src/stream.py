import pyaudio
import sys
import subprocess

# Audio stream parameters
FORMAT = pyaudio.paInt16  # 16-bit format
CHANNELS = 1  # Mono audio
RATE = 16000  # Sample rate
CHUNK = 1024  # Number of audio frames per buffer

def main():
    audio = pyaudio.PyAudio()

    # Open the stream
    stream = audio.open(format=FORMAT,
                        channels=CHANNELS,
                        rate=RATE,
                        input=True,
                        frames_per_buffer=CHUNK)

    # Define the command to spawn the external process
    cmd = [
        "C:\\Users\\filip\\AppData\\Roaming\\live-captions\\april-asr\\main.exe",
        "-",  # This assumes the executable accepts audio data from stdin
        "C:\\Users\\filip\\AppData\\Roaming\\live-captions\\april-asr\\april-english-dev-01110_en.april"
    ]

    # Spawn the external process
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    try:
        while True:
            data = stream.read(CHUNK, exception_on_overflow=False)
            # Pipe audio data to the stdin of the spawned process
            process.stdin.write(data)
            process.stdin.flush()
    except KeyboardInterrupt:
        # Stop and close the stream
        stream.stop_stream()
        stream.close()
        # Terminate the PortAudio interface
        audio.terminate()
        # Close the stdin of the spawned process and wait for it to terminate
        process.stdin.close()
        process.wait()
        print("Stream stopped and external process terminated")

if __name__ == "__main__":
    main()
