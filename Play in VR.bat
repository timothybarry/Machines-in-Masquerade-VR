@echo off
rem WebXR needs the page served from localhost, so this starts a tiny server and opens Edge.
cd /d "%~dp0"
start "" msedge http://localhost:8322/
python serve.py 8322
