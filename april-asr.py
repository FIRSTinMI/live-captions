from typing import List
import sys

import numpy as np
import april_asr as april

def example_handler(result_type: april.Result, tokens: List[april.Token]):
    """Simple handler that concatenates all tokens and prints it"""
    prefix = "."
    if result_type == april.Result.FINAL_RECOGNITION:
        prefix = "@"
    elif result_type == april.Result.PARTIAL_RECOGNITION:
        prefix = "-"

    string = ""
    for token in tokens:
        string += token.token

    print(f"{prefix}{string}")

def run(model_path: str) -> None:
    """Creates a model and session, and performs recognition on the given file"""
    # Load the model
    model = april.Model(model_path)

    # Create a session
    session = april.Session(model, example_handler)

    print("Model " + model.get_name() + " loaded. Waiting for audio data on stdin")
   
    k = 0
    try:
        while True:
            session.feed_pcm16(sys.stdin.read(480 * 2))
            k = k + 1
    except KeyboardInterrupt:
        session.flush()
        sys.stdout.flush()
        pass
    print(k)

def main():
    """Checks the given arguments and prints usage or calls the run function"""
    # Parse arguments
    args = sys.argv
    if len(args) != 2:
        print("Usage: " + args[0] + " /path/to/model.april")
    else:
        run(args[1])

if __name__ == "__main__":
    main()