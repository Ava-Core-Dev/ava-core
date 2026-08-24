#!/usr/bin/env python3
"""
File and folder mapper for /home/ava-core
Maps every single file and folder location under the specified directory.
"""

import os
import json
from pathlib import Path
from typing import Dict, List, Any
from datetime import datetime


def map_directory(root_path: str) -> Dict[str, Any]:
    """
    Recursively map all files and folders in a directory.
    
    Args:
        root_path: The root directory path to map
        
    Returns:
        A dictionary containing the complete directory structure
    """
    mapping = {
        "root": root_path,
        "timestamp": datetime.now().isoformat(),
        "structure": {},
        "file_count": 0,
        "folder_count": 0,
        "all_files": [],
        "all_folders": []
    }
    
    try:
        for root, dirs, files in os.walk(root_path):
            # Count folders
            mapping["folder_count"] += len(dirs)
            for folder in dirs:
                folder_path = os.path.join(root, folder)
                mapping["all_folders"].append(folder_path)
            
            # Count and list files
            mapping["file_count"] += len(files)
            for file in files:
                file_path = os.path.join(root, file)
                mapping["all_files"].append(file_path)
    
    except PermissionError as e:
        mapping["error"] = f"Permission denied: {e}"
    except Exception as e:
        mapping["error"] = f"Error mapping directory: {e}"
    
    return mapping


def save_mapping_as_json(mapping: Dict[str, Any], output_file: str = "file_mapping.json") -> None:
    """Save the mapping as a JSON file."""
    with open(output_file, 'w', encoding='utf-8', errors='replace') as f:
        json.dump(mapping, f, indent=2, ensure_ascii=False)
    print(f"✓ JSON mapping saved to {output_file}")


def save_mapping_as_text(mapping: Dict[str, Any], output_file: str = "file_mapping.txt") -> None:
    """Save the mapping as a human-readable text file."""
    with open(output_file, 'w', encoding='utf-8', errors='replace') as f:
        f.write(f"Directory Mapping for: {mapping['root']}\n")
        f.write(f"Generated: {mapping['timestamp']}\n")
        f.write("=" * 80 + "\n\n")
        
        f.write(f"SUMMARY:\n")
        f.write(f"Total Folders: {mapping['folder_count']}\n")
        f.write(f"Total Files: {mapping['file_count']}\n\n")
        
        if "error" in mapping:
            f.write(f"ERROR: {mapping['error']}\n\n")
        
        f.write("ALL FOLDERS:\n")
        f.write("-" * 80 + "\n")
        for folder in sorted(mapping['all_folders']):
            try:
                f.write(f"{folder}\n")
            except UnicodeEncodeError:
                f.write(f"{folder.encode('utf-8', errors='replace').decode('utf-8')}\n")
        
        f.write("\n\nALL FILES:\n")
        f.write("-" * 80 + "\n")
        for file in sorted(mapping['all_files']):
            try:
                f.write(f"{file}\n")
            except UnicodeEncodeError:
                f.write(f"{file.encode('utf-8', errors='replace').decode('utf-8')}\n")
    
    print(f"✓ Text mapping saved to {output_file}")


def print_summary(mapping: Dict[str, Any]) -> None:
    """Print a summary of the mapping."""
    print("\n" + "=" * 80)
    print(f"Directory Mapping Complete")
    print("=" * 80)
    print(f"Root Directory: {mapping['root']}")
    print(f"Total Folders: {mapping['folder_count']}")
    print(f"Total Files: {mapping['file_count']}")
    print(f"Generated: {mapping['timestamp']}")
    
    if "error" in mapping:
        print(f"\nWARNING: {mapping['error']}")
    
    print("=" * 80 + "\n")


def main():
    """Main function to run the directory mapper."""
    root_directory = "/home/ava-core"
    
    print(f"Scanning directory: {root_directory}")
    print("This may take a moment...\n")
    
    # Check if directory exists
    if not os.path.exists(root_directory):
        print(f"ERROR: Directory {root_directory} does not exist!")
        return
    
    # Map the directory
    mapping = map_directory(root_directory)
    
    # Save outputs
    save_mapping_as_json(mapping, "file_mapping.json")
    save_mapping_as_text(mapping, "file_mapping.txt")
    
    # Print summary
    print_summary(mapping)
    
    # Print first 10 files as sample
    if mapping['all_files']:
        print("Sample of mapped files (first 10):")
        for file in sorted(mapping['all_files'])[:10]:
            print(f"  - {file}")
        if len(mapping['all_files']) > 10:
            print(f"  ... and {len(mapping['all_files']) - 10} more files")


if __name__ == "__main__":
    main()