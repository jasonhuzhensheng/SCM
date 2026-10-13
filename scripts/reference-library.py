#!/usr/bin/env python3
"""Offline conversion: compare every byte, then replace a managed copy with a reference."""
import argparse
import collections
import json
import os
from pathlib import Path
import stat
import time
import uuid


def signature(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def convert(source, target, apply=False):
    source, target = Path(source), Path(target)
    if not source.is_absolute():
        return 'invalid-source', 0
    before = target.lstat()
    if stat.S_ISLNK(before.st_mode):
        return 'referenced', 0
    original = source.resolve(strict=True)
    if original.is_relative_to(target.parent.resolve()):
        return 'internal-source', 0
    s = original.stat()
    if not stat.S_ISREG(s.st_mode) or not stat.S_ISREG(before.st_mode):
        return 'not-file', 0
    if s.st_size != before.st_size:
        return 'different', 0
    with original.open('rb') as left, target.open('rb') as right:
        while True:
            block = left.read(4 * 1024 * 1024)
            if block != right.read(4 * 1024 * 1024):
                return 'different', 0
            if not block:
                break
    if signature(original.stat()) != signature(s) or signature(target.lstat()) != signature(before):
        return 'changed', 0
    if not apply:
        return 'eligible', before.st_size
    # Keep an independent directory entry until the replacement is verified.
    # A hard-link backup consumes no additional media blocks.
    token = uuid.uuid4().hex
    backup = target.with_name('.reference-backup-' + token)
    link = target.with_name('.reference-link-' + token)
    os.link(target, backup)
    try:
        os.symlink(str(original), link)
        # link() changes ctime on the copy; size/mtime/inode must still match.
        now = target.lstat()
        if signature(original.stat()) != signature(s) or signature(now)[:4] != signature(before)[:4]:
            return 'changed', 0
        os.replace(link, target)
        if signature(target.stat()) != signature(s):
            os.replace(backup, target)
            return 'changed', 0
        return 'converted', before.st_size
    except BaseException:
        if target.is_symlink():
            os.replace(backup, target)
        raise
    finally:
        link.unlink(missing_ok=True)
        backup.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('library', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    library = args.library.resolve()
    index = library / 'memories-index.json'
    baseline = signature(index.stat())
    data = json.loads(index.read_text())
    names, sources = data['images'], data['sources']
    if len(names) != len(sources):
        raise RuntimeError('Index alignment mismatch')
    # Refuse concurrent migrations. A crash leaves the lock for manual review.
    lock = library / '.reference-migration.lock'
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    counts, total = collections.Counter(), 0
    report = library / ('reference-migration-' + str(time.time_ns()) + '.jsonl')
    try:
        with report.open('x') as log:
            for i, (name, source) in enumerate(zip(names, sources)):
                if signature(index.stat()) != baseline:
                    raise RuntimeError('Library changed. Stop the app before migration.')
                if not isinstance(name, str) or Path(name).name != name or not isinstance(source, str):
                    raise RuntimeError('Invalid index entry')
                # Durable intent records make an interrupted run auditable.
                log.write(json.dumps({'filename': name, 'source': source, 'phase': 'checking'}, ensure_ascii=False) + '\n')
                log.flush()
                if args.apply:
                    os.fsync(log.fileno())
                try:
                    result, size = convert(source, library / 'photos' / name, args.apply)
                except OSError as error:
                    result, size = 'unavailable', 0
                counts[result] += 1
                total += size
                log.write(json.dumps({'filename': name, 'result': result, 'logicalBytes': size}, ensure_ascii=False) + '\n')
                if (i + 1) % 1000 == 0:
                    print(json.dumps({'processed': i + 1, 'total': len(names), 'counts': counts, 'logicalGiB': round(total / 1024**3, 2)}), flush=True)
        print(json.dumps({'counts': counts, 'logicalBytes': total, 'report': str(report)}), flush=True)
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
