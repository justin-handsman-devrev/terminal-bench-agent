#!/usr/bin/env python3
"""
Python wrapper for TypeScript Multi-Agent Coding System
Enables Terminal-Bench integration by providing a Python interface
"""

import os
import subprocess
import json
import tempfile
import shlex
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv
except ImportError:
    # Fallback if python-dotenv is not installed
    def load_dotenv(dotenv_path=None):
        pass

# Import terminal-bench classes (required)
from terminal_bench.agents import BaseAgent
from terminal_bench.agents.base_agent import AgentResult
from terminal_bench.agents.failure_mode import FailureMode
from terminal_bench.terminal.tmux_session import TmuxSession


class TypeScriptAgentWrapper(BaseAgent):
    """Python wrapper for the TypeScript Multi-Agent Coding System"""
    
    def __init__(self, **kwargs):
        # Terminal-bench may pass additional kwargs like 'no_rebuild'
        # We'll store them but they don't affect our TypeScript agent
        self._terminal_bench_kwargs = kwargs
        
        self.agent_dir = Path(__file__).parent
        self.node_executable = self._find_node()
        self.agent_script = self.agent_dir / "dist" / "index.js"
        
        # Load environment variables from .env file
        env_file = self.agent_dir / ".env"
        if env_file.exists():
            load_dotenv(env_file)
        
        # Ensure the TypeScript agent is built (unless no_rebuild is specified)
        should_build = not kwargs.get('no_rebuild', False)
        if should_build and not self.agent_script.exists():
            self._build_agent()
    
    @staticmethod
    def name() -> str:
        return "typescript-multi-agent"
    
    def _find_node(self) -> str:
        """Find the Node.js executable"""
        try:
            result = subprocess.run(['which', 'node'], capture_output=True, text=True, check=True)
            return result.stdout.strip()
        except subprocess.CalledProcessError:
            # Fallback paths
            common_paths = ['/usr/bin/node', '/usr/local/bin/node', '/opt/homebrew/bin/node']
            for path in common_paths:
                if os.path.exists(path):
                    return path
            raise RuntimeError("Node.js not found. Please install Node.js or ensure it's in your PATH.")
    
    def _build_agent(self) -> None:
        """Build the TypeScript agent if not already built"""
        print("Building TypeScript agent...")
        try:
            subprocess.run(['npm', 'run', 'build'], 
                         cwd=self.agent_dir, 
                         check=True, 
                         capture_output=True)
            print("TypeScript agent built successfully.")
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Failed to build TypeScript agent: {e.stderr.decode()}")
    
    def _setup_environment(self) -> dict:
        """Setup environment variables for the TypeScript agent"""
        env = os.environ.copy()
        
        # Ensure required environment variables are set
        if 'OPENROUTER_API_KEY' not in env and 'OPENAI_API_KEY' not in env:
            raise RuntimeError(
                "No API key found. Please set OPENROUTER_API_KEY or OPENAI_API_KEY environment variable."
            )
        
        # Set default model if not specified
        if 'LITELLM_MODEL' not in env:
            if 'OPENROUTER_API_KEY' in env:
                env['LITELLM_MODEL'] = 'anthropic/claude-3.5-sonnet'
            else:
                env['LITELLM_MODEL'] = 'gpt-4'
        
        # Set default temperature
        if 'LITELLM_TEMPERATURE' not in env:
            env['LITELLM_TEMPERATURE'] = '0.1'
        
        return env
    
    def perform_task(
        self,
        instruction: str,
        session: TmuxSession,
        logging_dir: Optional[Path] = None,
    ) -> AgentResult:
        """
        Execute a task using the TypeScript multi-agent system
        
        Args:
            instruction: The task to perform
            session: Terminal session (for terminal-bench compatibility)
            logging_dir: Directory for logging output
            
        Returns:
            AgentResult indicating success/failure and any message
        """
        try:
            # Setup environment
            env = self._setup_environment()
            
            # Check if we have a Terminal-Bench session available
            print(f"Session type: {type(session)}")
            print(f"Session has send_keys: {hasattr(session, 'send_keys')}")
            
            if hasattr(session, 'send_keys'):
                # We're in Terminal-Bench - use the TypeScript agent with session integration
                return self._run_with_terminal_bench_session(instruction, session, env, logging_dir)
            else:
                # Fall back to direct execution for non-Terminal-Bench environments
                return self._run_direct_execution(instruction, env, logging_dir)
                
        except subprocess.TimeoutExpired:
            error_msg = "Task timed out after 1 hour"
            print(f"Error: {error_msg}")
            return AgentResult(
                failure_mode=FailureMode.AGENT_TIMEOUT,
                total_input_tokens=0,
                total_output_tokens=0
            )
            
        except Exception as e:
            error_msg = f"Unexpected error: {str(e)}"
            print(f"Error: {error_msg}")
            return AgentResult(
                failure_mode=FailureMode.UNKNOWN_AGENT_ERROR,
                total_input_tokens=0,
                total_output_tokens=0
            )
    
    def _run_with_terminal_bench_session(
        self, 
        instruction: str, 
        session: TmuxSession, 
        env: dict, 
        logging_dir: Optional[Path] = None
    ) -> AgentResult:
        """
        Run the TypeScript agent using Terminal-Bench's session for container compatibility
        """
        try:
            print("Running TypeScript agent with Terminal-Bench session integration")
            
            # User requested to run their own terminal-agent; avoid direct handlers
        
            
            # Discover the active Terminal-Bench container from host and run the TS agent on host,
            # targeting the container via DockerExecutor (using --container)
            container_id = self._find_tb_container_id()
            if not container_id:
                print("Error: Could not locate Terminal-Bench container to target with DockerExecutor")
                return AgentResult(
                    failure_mode=FailureMode.UNKNOWN_AGENT_ERROR,
                    total_input_tokens=0,
                    total_output_tokens=0,
                )

            print(f"Discovered Terminal-Bench container: {container_id}")

            # Run the TypeScript agent on the host, instructing it to use DockerExecutor
            cmd = [
                self.node_executable,
                str(self.agent_script),
                'run',
                '--container',
                container_id,
                instruction,
            ]

            print(f"Executing TS agent on host targeting container {container_id}")
            result = subprocess.run(
                cmd,
                cwd=self.agent_dir,
                env={**env, 'TERMINAL_BENCH_SESSION': 'true'},
                capture_output=True,
                text=True,
                timeout=3600,
            )

            if result.stdout:
                print(result.stdout)
            if result.stderr:
                print(result.stderr)

            success = result.returncode == 0

            # Capture git metadata into /runs logging directory if provided
            try:
                self._capture_git_metadata(logging_dir)
            except Exception as e:
                print(f"Warning: failed to capture git metadata: {e}")

            return AgentResult(
                failure_mode=FailureMode.NONE if success else FailureMode.UNKNOWN_AGENT_ERROR,
                total_input_tokens=0,
                total_output_tokens=0,
            )
            
        except Exception as e:
            print(f"Error in Terminal-Bench session execution: {e}")
            return AgentResult(
                failure_mode=FailureMode.UNKNOWN_AGENT_ERROR,
                total_input_tokens=0,
                total_output_tokens=0
            )
    
    def _run_direct_execution(
        self, 
        instruction: str, 
        env: dict, 
        logging_dir: Optional[Path] = None
    ) -> AgentResult:
        """
        Run the TypeScript agent directly (for non-Terminal-Bench environments)
        """
        try:
            # Prepare the command
            cmd = [
                self.node_executable,
                str(self.agent_script),
                'run',
                instruction
            ]
            
            working_dir = self.agent_dir
            
            print(f"Running TypeScript agent with task: {instruction}")
            print(f"Working directory: {working_dir}")
            print(f"Model: {env.get('LITELLM_MODEL', 'default')}")
            
            # Execute the TypeScript agent
            result = subprocess.run(
                cmd,
                cwd=working_dir,
                env=env,
                capture_output=True,
                text=True,
                timeout=3600  # 1 hour timeout
            )
            
            # Log output if logging directory is provided
            if logging_dir:
                logging_dir = Path(logging_dir)
                logging_dir.mkdir(parents=True, exist_ok=True)
                
                with open(logging_dir / "typescript_agent_stdout.log", "w") as f:
                    f.write(result.stdout)
                
                with open(logging_dir / "typescript_agent_stderr.log", "w") as f:
                    f.write(result.stderr)
            
            # Determine success based on return code
            success = result.returncode == 0

            # Capture git metadata into /runs logging directory if provided
            try:
                self._capture_git_metadata(logging_dir)
            except Exception as e:
                print(f"Warning: failed to capture git metadata: {e}")
            
            # Set appropriate failure mode
            failure_mode = FailureMode.NONE if success else FailureMode.UNKNOWN_AGENT_ERROR
            
            print(f"Task result: {'SUCCESS' if success else 'FAILURE'}")
            print(f"Return code: {result.returncode}")
            if result.stdout:
                print(f"Output: {result.stdout.strip()}")
            if result.stderr:
                print(f"Error: {result.stderr.strip()}")
            
            return AgentResult(
                failure_mode=failure_mode,
                total_input_tokens=0,  # Could be extracted from TypeScript agent logs if needed
                total_output_tokens=0  # Could be extracted from TypeScript agent logs if needed
            )
            
        except subprocess.TimeoutExpired:
            raise  # Let the parent handle this
        except Exception as e:
            raise  # Let the parent handle this

    def _find_tb_container_id(self) -> Optional[str]:
        """Attempt to find the active Terminal-Bench container name/id."""
        try:
            # docker ps --format '{{.ID}} {{.Image}} {{.Names}}'
            proc = subprocess.run(
                ['docker', 'ps', '--format', '{{.ID}} {{.Image}} {{.Names}}'],
                capture_output=True,
                text=True,
                check=True,
            )
            lines = proc.stdout.strip().splitlines()
            for line in lines:
                parts = line.split()
                if len(parts) < 3:
                    continue
                cid, image, name = parts[0], parts[1], parts[2]
                # Heuristic: TB task containers often have names like <task>_<service>_1
                # and image referencing terminal-bench dataset images
                if 'terminal-bench' in image or name.endswith('_agent_1') or name.endswith('_app_1'):
                    return name
            # Fallback: return first container id if any
            if lines:
                return lines[0].split()[0]
            return None
        except Exception:
            return None

    def _capture_git_metadata(self, logging_dir: Optional[Path]) -> None:
        """Write git status and diff files into the provided logging_dir (i.e., /runs/<ts>/)."""
        if not logging_dir:
            return
        run_dir = Path(logging_dir)
        run_dir.mkdir(parents=True, exist_ok=True)

        def _run_git(args: list[str]) -> subprocess.CompletedProcess:
            return subprocess.run(
                ['git', *args],
                cwd=self.agent_dir,
                capture_output=True,
                text=True,
            )

        status = _run_git(['status', '--porcelain=v1', '--branch'])
        diff_ws = _run_git(['diff'])
        diff_staged = _run_git(['diff', '--cached'])
        head = _run_git(['show', '--no-patch', '--pretty=fuller', 'HEAD'])

        (run_dir / 'git-status.txt').write_text(status.stdout or status.stderr or '', encoding='utf-8')
        (run_dir / 'git-diff.patch').write_text(diff_ws.stdout or diff_ws.stderr or '', encoding='utf-8')
        (run_dir / 'git-diff-staged.patch').write_text(diff_staged.stdout or diff_staged.stderr or '', encoding='utf-8')
        (run_dir / 'git-head.txt').write_text(head.stdout or head.stderr or '', encoding='utf-8')

# For direct testing without terminal-bench
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) != 2:
        print("Usage: python terminal_bench_wrapper.py '<task_description>'")
        sys.exit(1)
    
    task = sys.argv[1]
    
    # Mock session for testing
    class MockSession:
        def get_cwd(self):
            return os.getcwd()
    
    wrapper = TypeScriptAgentWrapper()
    result = wrapper.perform_task(task, MockSession())
    
    print(f"\nFinal Result:")
    print(f"Failure Mode: {result.failure_mode}")
    print(f"Success: {result.failure_mode == FailureMode.NONE}")
    
    sys.exit(0 if result.failure_mode == FailureMode.NONE else 1)
