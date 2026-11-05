# Setup without Git

## Download the agent on the Kroll PC

1. On any PC that can open the internet, go to:
   https://github.com/Bot-Maker-Me/pharmaflow
2. Click the green **Code** button → **Download ZIP**
3. Unzip. Copy the whole `helper` folder into `C:\PharmFlow\helper`
   (overwrite old files, keep your `config.ini`).
4. On the Kroll PC open Command Prompt:

```bat
cd C:\PharmFlow\helper
.\venv\Scripts\activate
python assemble_agent.py
python flow.py --test
```

If `assemble_agent.py` is missing parts, copy `flow_body.py` from the
chat download (`pharmflow_flow_body.py`) into this folder as `flow_body.py`.

## Do NOT type this literally

```bat
copy /Y path\to\pharmflow_flow_body.py flow_body.py
```

`path\to\` was an example. Use the real folder where you saved the file, e.g.:

```bat
copy /Y C:\Users\Rx\Downloads\pharmflow_flow_body.py C:\PharmFlow\helper\flow_body.py
```
