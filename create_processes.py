#!/usr/bin/env python

import os
import sys
import json


def create_process(d, port, path):
    name = '-'.join(d.split('-')[1:])
    process_base = {
        'name': "%s" % name,
        'script': 'server.js',
        'args': ['--as_uri=http://130.206.81.33:%s' % port, '--ws_uri=ws://130.206.81.33:8888/kurento'],
        'log_date_format': 'YYYY-MM-DD HH:mm Z',
        'log_file': '/var/log/%s.log' % name,
        'error_file': '/var/log/%s-err.log' % name,
        'out_file': '/var/log/%s-out.log' % name,
        'pid_file': '/var/run/%s.pid' % name,
        'ignore_watch': ['[\\/\\\\]\\./', 'node_modules'],
        'watch': 'true',
        'cwd': "%s" % path,
        'env': {}
    }

    return process_base


def main():
    processes = []
    base_path = os.path.dirname(os.path.abspath(__file__))
    dirs = filter(lambda x: not x.startswith('.'), next(os.walk('.'))[1])
    if len(sys.argv) > 1:
        dirs = [x for x in sys.argv[1:]]

    port = 8081
    for d in dirs:
        cp = create_process(d, port, os.path.join(base_path, d))
        port += 1
        processes.append(cp)

    final = {"apps": processes}
    with open('auto_processes.json', 'w') as f:
        json.dump(final, f, ensure_ascii=False, sort_keys=True,
                  indent=4, separators=(',', ': '))


if __name__ == "__main__":
    main()
