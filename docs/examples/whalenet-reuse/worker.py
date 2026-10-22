import json
import math
import os
import statistics
import sys

training = None
sequence = 0


def profile(rows):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 1000:
        raise ValueError('Expected 1 to 1000 measurements')
    grouped = {}
    for row in rows:
        job, value = row['job'], row['seconds']
        if not isinstance(job, str) or not 1 <= len(job) <= 80:
            raise ValueError('Invalid job name')
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= 86400:
            raise ValueError('Invalid duration')
        grouped.setdefault(job, []).append(value)
    return {job: {'count': len(values), 'median': statistics.median(values),
                  'mad': statistics.median(abs(v - statistics.median(values)) for v in values),
                  'min': min(values), 'max': max(values)} for job, values in grouped.items()}


for line in sys.stdin:
    sequence += 1
    request = None
    try:
        request = json.loads(line)
        operation = request['operation']
        if operation == 'profile':
            training = profile(request['rows'])
            result = {'profile': training}
        elif operation == 'fit':
            if training is None:
                raise ValueError('Inspect training data in this worker before publishing')
            multiplier, relative = request['mad_multiplier'], request['minimum_regression']
            if not 3 <= multiplier <= 8 or not 0.1 <= relative <= 0.5:
                raise ValueError('Detector parameters exceed the permitted envelope')
            result = {'rules': {job: {'baseline_seconds': stats['median'],
                       'threshold_seconds': stats['median'] + max(stats['median'] * relative, 1.4826 * stats['mad'] * multiplier)}
                       for job, stats in training.items()}}
        elif operation == 'score':
            rows = request['rows']
            profile(rows)
            rules = request['rules']
            if any(row['job'] not in rules for row in rows):
                raise ValueError('Unknown job requires a new reviewed capability')
            result = {'results': [{**row, 'threshold_seconds': rules[row['job']]['threshold_seconds'],
                       'regression': row['seconds'] > rules[row['job']]['threshold_seconds']} for row in rows]}
        else:
            raise ValueError('Unsupported operation')
        response = {'id': request['id'], 'result': result, 'python_pid': os.getpid(), 'sequence': sequence}
    except (KeyError, TypeError, ValueError) as error:
        response = {'id': request.get('id') if isinstance(request, dict) else None, 'error': str(error),
                    'python_pid': os.getpid(), 'sequence': sequence}
    print(json.dumps(response, allow_nan=False), flush=True)
