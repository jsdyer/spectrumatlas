"""Build province-split ISED Spectrum Atlas datasets and a vendored map engine."""
import argparse
import csv
from datetime import date
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import tarfile
import tempfile
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://ised-isde.canada.ca/site/spectrum-management-system/en/spectrum-management-system-data/download-sms-data'
BASE = 'https://www.ic.gc.ca/engineering/SMS_TAFL_Files/'
EXTRACTS = {'fixed': 'TAFL_LTAF_Fixe.zip', 'terrestrial': 'Site_Data_Extract_FX.zip'}
LEAFLET = 'https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz'
# Registry SHA-512 integrity for Leaflet 1.9.4.
LEAFLET_SHA512 = 'sha512-nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA=='
PROVINCES = ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT')
SITE_FIELDS = ('province_code', 'latitude', 'longitude', 'tx_frequency', 'rx_frequency',
               'licence_category*', 'technology', 'location', 'licensee_name*',
               'licence_number', 'record_id', 'date_last_changed', 'station_type')
FIXED_FIELDS = {
    'function': 0, 'frequency': 1, 'record': 2, 'location': 31, 'callsign': 33,
    'class': 35, 'province': 39, 'latitude': 40, 'longitude': 41,
    'authorization': 47, 'status': 51, 'date': 52, 'holder': 54,
}
STATUS = {
    'G': 'Granted', 'NG': 'Not granted', 'P': 'Preliminarily granted',
    '-4': 'Preliminarily cancelled', '-3': 'Modified', '-2': 'Cancelled',
    '11': 'Authorized', '12': 'Passed technical analysis', '13': 'Passed safety check',
    '14': 'Passed coordination', '15': 'Technical analysis', '16': 'On-air testing',
}


def download(url, destination, maximum):
    request = Request(url, headers={'User-Agent': 'CoolCode Spectrum Atlas public data build'})
    with urlopen(request, timeout=90) as response, destination.open('wb') as file:
        size = 0
        while chunk := response.read(1048576):
            size += len(chunk)
            if size > maximum:
                raise ValueError(f'Unexpected download size at {url}')
            file.write(chunk)


def real_number(value):
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def compact(row, kind, fields):
    if kind == 'terrestrial':
        get = lambda field: row[fields[field]].strip()
        province = get('province_code')
        if province not in PROVINCES:
            return None
        lat, lng = real_number(get('latitude')), real_number(get('longitude'))
        tx, rx = real_number(get('tx_frequency')), real_number(get('rx_frequency'))
        category = ' · '.join(s for s in (get('licence_category*'), get('technology')) if s)
        data = (get('location'), get('licensee_name*'), get('licence_number'), get('record_id'),
                category, get('station_type'), '', get('date_last_changed'))
    else:
        get = lambda field: row[FIXED_FIELDS[field]].strip()
        province = get('province')
        if province not in PROVINCES:
            return None
        lat, lng = real_number(get('latitude')), real_number(get('longitude'))
        frequency = real_number(get('frequency'))
        function = get('function').upper()
        if function not in ('TX', 'RX'):
            return None
        tx, rx = (frequency, None) if function == 'TX' else (None, frequency)
        raw_status = get('status')
        status = STATUS.get(raw_status, raw_status)
        data = (get('location'), get('holder'), get('authorization'), get('record'),
                get('class'), get('callsign'), status, get('date'))
    if lat is None or lng is None or not (40 <= lat <= 84 and -142 <= lng <= -50):
        return None
    tx = round(tx, 6) if tx is not None and tx > 0 else None
    rx = round(rx, 6) if rx is not None and rx > 0 else None
    return province, (round(lat, 6), round(lng, 6), tx, rx, *data)


def prepare(kind, path, output):
    counts = dict.fromkeys(PROVINCES, 0)
    streams = {key: tempfile.TemporaryFile(mode='w+', encoding='utf-8') for key in PROVINCES}
    dictionaries = {key: {'': 0} for key in PROVINCES}
    malformed = 0
    with zipfile.ZipFile(path) as archive:
        members = [item for item in archive.infolist() if item.filename.lower().endswith('.csv')]
        if len(members) != 1 or not 100000 <= members[0].file_size <= 3000000000:
            raise ValueError('Unexpected ISED ZIP archive contents')
        member = members[0]
        extract_date = date(*member.date_time[:3]).isoformat()
        with io.TextIOWrapper(archive.open(member), encoding='utf-8-sig', errors='replace', newline='') as text:
            read = csv.reader(text)
            fields = {}
            if kind == 'terrestrial':
                header = next(read)
                fields = {key: header.index(key) for key in SITE_FIELDS}
            else:
                # The fixed service CSV is headerless. Indexes follow the ISED guide.
                import itertools
                first = next(read)
                if len(first) != 61 or first[0] not in ('TX', 'RX'):
                    raise ValueError('Fixed service CSV shape does not match the TAFL field description')
                read = itertools.chain([first], read)
            for row in read:
                if not row:
                    continue
                if len(row) != 61:
                    malformed += 1
                    continue
                parsed = compact(row, kind, fields)
                if not parsed:
                    continue
                province, values = parsed
                table = dictionaries[province]
                indexes = [table.setdefault(value, len(table)) for value in values[4:]]
                if counts[province]:
                    streams[province].write(',')
                streams[province].write(json.dumps((*values[:4], *indexes), separators=(',', ':')))
                counts[province] += 1
    if malformed:
        print(f'{kind}: skipped {malformed:,} records that did not match the documented width')
    shards = []
    for province in PROVINCES:
        if not counts[province]:
            raise ValueError(f'No {kind} records mapped in {province}')
        filename = f'{kind}-{province.lower()}.json'
        stats = {'kind': kind, 'province': province, 'file': filename, 'count': counts[province], 'extractDate': extract_date}
        with streams[province] as spool, (output / filename).open('w', encoding='utf-8') as target:
            target.write('{"index":')
            json.dump(list(dictionaries.pop(province)), target, ensure_ascii=False, separators=(',', ':'))
            target.write(',"rows":[')
            spool.seek(0)
            shutil.copyfileobj(spool, target)
            target.write(']}')
        shards.append(stats)
        print(f'{filename}: {stats["count"]:,} rows · {((output / filename).stat().st_size / 1048576):.1f} MiB')
    return shards


def map_engine(path, output):
    import base64
    digest = base64.b64encode(hashlib.sha512(path.read_bytes()).digest()).decode()
    if 'sha512-' + digest != LEAFLET_SHA512:
        raise ValueError('Unexpected Leaflet package checksum')
    with tarfile.open(path, 'r:gz') as archive:
        for internal, external in (
            ('package/dist/leaflet.js', 'leaflet.js'),
            ('package/dist/leaflet.css', 'leaflet.css'),
            ('package/LICENSE', 'LEAFLET-LICENSE.txt'),
        ):
            with archive.extractfile(internal) as source, (output / external).open('wb') as target:
                shutil.copyfileobj(source, target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixed', type=Path, help='Reuse a saved official fixed service ZIP')
    parser.add_argument('--terrestrial', type=Path, help='Reuse a saved official terrestrial sites ZIP')
    parser.add_argument('--leaflet', type=Path, help='Reuse a saved copy of the pinned Leaflet npm tarball')
    cli = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='spectrumatlas-') as working_dir:
        working = Path(working_dir)
        output = working / 'dist'
        shutil.copytree(ROOT / 'web', output)
        shards = []
        for kind, filename in EXTRACTS.items():
            path = getattr(cli, kind) or working / filename
            if not getattr(cli, kind):
                download(BASE + filename, path, maximum=250000000)
            shards.extend(prepare(kind, path, output))
        leaf = cli.leaflet or working / 'leaflet.tgz'
        if not cli.leaflet:
            download(LEAFLET, leaf, maximum=2000000)
        map_engine(leaf, output)
        (output / 'manifest.json').write_text(
            json.dumps({'built': date.today().isoformat(), 'source': SOURCE, 'shards': shards}, separators=(',', ':')),
            encoding='utf-8',
        )
        (output / '.nojekyll').touch()
        destination = ROOT / 'dist'
        shutil.rmtree(destination, ignore_errors=True)
        shutil.move(str(output), destination)


if __name__ == '__main__':
    main()
