"""Ensure every distribution contains the browser renderer and widget assets."""

from pathlib import Path
import subprocess

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        root = Path(self.root)
        assets = root / "craggy_charts" / "static"
        required = ("widget.js", "craggy-charts.global.js")
        if not all((assets / name).is_file() for name in required):
            script = root / "build.mjs"
            if not script.is_file():
                raise RuntimeError("Browser assets are missing from the source distribution")
            try:
                subprocess.run(["node", str(script)], check=True, cwd=root)
            except (OSError, subprocess.CalledProcessError) as exc:
                raise RuntimeError(
                    "Could not build browser assets; install Node.js and run npm ci in js/"
                ) from exc
        if not all((assets / name).is_file() for name in required):
            raise RuntimeError("Browser asset build did not produce all required files")
