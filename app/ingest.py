"""Explicit adapters. A source row stays traceable to its worksheet and line."""
import csv
import io
import re
import zipfile
from collections import Counter
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from itertools import islice

from openpyxl import load_workbook

MAX_BYTES = 20 * 1024 * 1024
MAX_ROWS = 50000
REQUIRED = {'upc', 'category', 'description', 'paid_amount'}
ALIASES = {
    'upc_code': 'upc', 'cat_desc': 'category', 'sub_cat_desc': 'subcategory',
    'brand_name': 'brand', 'food_desc': 'description', 'unit_quantity': 'quantity',
    'package_quantity': 'packages', 'avg_price': 'source_avg_price',
}


class DataError(ValueError):
    pass


def clean(value):
    return re.sub(r'\s+', ' ', str(value if value is not None else '')).strip()


def header(value):
    value = clean(value).lower().replace(' ', '_')
    return ALIASES.get(value, value)


def number(value, field, optional=False):
    if value is None or clean(value) in ('', '-', '—', 'N/A', 'NA'):
        if optional:
            return None
        raise DataError(f'{field} is missing.')
    try:
        result = Decimal(str(value).replace(',', '').replace('$', '').strip())
    except InvalidOperation:
        raise DataError(f'{field} must be a number.')
    if not result.is_finite() or abs(result) > Decimal('1000000000000'):
        raise DataError(f'{field} is outside the supported range.')
    return result


def period_valid(value):
    if not re.fullmatch(r'20\d{2}-(?:Q[1-4]|0[1-9]|1[0-2])', value):
        raise DataError('Use YYYY-Q1 to YYYY-Q4, or YYYY-MM for the report period.')
    return value


def infer_period(filename):
    m = re.search(r'([1-4])Q\s*(20\d{2})', filename, re.I)
    if m:
        return f'{m[2]}-Q{m[1]}'
    m = re.search(r'(20\d{2})[- _]?(Q[1-4]|0[1-9]|1[0-2])', filename, re.I)
    return f'{m[1]}-{m[2].upper()}' if m else ''


def read_sheets(content, filename):
    if len(content) > MAX_BYTES:
        raise DataError('The file exceeds the 20 MB limit.')
    if filename.lower().endswith('.csv'):
        try:
            rows = list(islice(csv.reader(io.StringIO(content.decode('utf-8-sig'))), MAX_ROWS + 32))
        except (UnicodeError, csv.Error):
            raise DataError('Use a UTF-8 CSV file or an XLSX workbook.')
        if len(rows) > MAX_ROWS + 30:
            raise DataError('The file exceeds the 50,000 row limit.')
        return {'CSV': rows}
    if not filename.lower().endswith('.xlsx'):
        raise DataError('Choose an XLSX workbook or a UTF-8 CSV file.')
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 120 * 1024 * 1024:
                raise DataError('The expanded workbook exceeds the 120 MB limit.')
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True, keep_links=False)
        result = {}
        for sheet in workbook:
            if sheet.max_column and sheet.max_column > 100:
                continue
            rows = list(islice(sheet.values, MAX_ROWS + 32))
            if len(rows) > MAX_ROWS + 30:
                raise DataError('A worksheet exceeds the 50,000 row limit.')
            result[sheet.title] = rows
        workbook.close()
        return result
    except DataError:
        raise
    except Exception:
        raise DataError('The workbook cannot be read. Save it as a valid XLSX file.')


def locate(rows):
    for i, row in enumerate(rows[:30]):
        names = [header(v) for v in row]
        if REQUIRED.issubset(names):
            return i, names
        if 'upc' in names and 'description' in names and any('paid_amt' in n or 'paid_amount' in n for n in names):
            return i, names
    return None


def inspect(content, filename):
    sheets = read_sheets(content, filename)
    candidates = []
    for name, rows in sheets.items():
        match = locate(rows)
        if match:
            candidates.append({'name': name, 'header_row': match[0] + 1, 'rows': max(0, len(rows) - match[0] - 1)})
    if not candidates:
        raise DataError('No supported table was found. Use the CSV template or an Indiana export workbook.')
    preferred = next((x['name'] for x in candidates if x['name'] == 'Export Worksheet'), candidates[0]['name'])
    return {'sheets': candidates, 'sheet': preferred, 'period': infer_period(filename),
            'state': 'IN' if re.search(r'\bIN\b|Indiana', filename, re.I) else ''}


def parse(content, filename, sheet, state, period):
    if not re.fullmatch(r'[A-Z0-9][A-Z0-9 .-]{1,59}', state):
        raise DataError('Enter a jurisdiction code or agency name (2 to 60 characters).')
    sheets = read_sheets(content, filename)
    if sheet not in sheets:
        raise DataError('The selected worksheet does not exist.')
    raw = sheets[sheet]
    located = locate(raw)
    if not located:
        raise DataError('The selected worksheet has no supported table.')
    start, names = located
    texas = not REQUIRED.issubset(names)
    if texas and not any('peanut butter' in clean(v).lower() for row in raw[:start+1] for v in row):
        raise DataError('This Texas table format is not supported. Use the normalized CSV template.')
    if texas and state != 'TX':
        raise DataError('The Texas report requires the TX state code.')
    if not texas:
        if 'period' not in names:
            period_valid(period)
        used = [n for n in names if n in REQUIRED or n in ('period', 'brand', 'unit', 'quantity', 'packages', 'subcategory', 'package_size')]
        if len(used) != len(set(used)):
            raise DataError('The table has duplicate column names.')
    records, issues, skipped = [], [], 0
    missing_brand = numeric_codes = negative = 0
    seen = set()
    section = 'Peanut butter'
    for line, values in enumerate(raw[start + 1:], start + 2):
        if not any(v is not None and str(v).strip() for v in values):
            continue
        row = dict(zip(names, values))
        upc = row.get('upc')
        aggregate = texas and not upc and bool(clean(row.get('description')))
        if texas and upc and not clean(row.get('description')) and clean(upc).lower() not in ('total', 'grand total'):
            section = clean(upc)
            skipped += 1
            continue
        # Summary rows cannot be mixed with product rows.
        if (not clean(upc) and not aggregate) or clean(upc).lower() in ('total', 'grand total', 'upc'):
            if not texas and not clean(upc) and clean(row.get('category')) and clean(row.get('description')):
                issues.append(f'Row {line}: the product code is missing.')
            else:
                skipped += 1
            continue
        if isinstance(upc, (int, float)):
            if int(upc) != upc:
                issues.append(f'Row {line}: the product code is not an integer.')
                continue
            upc = str(int(upc))
            numeric_codes += 1
        upc = clean(upc)
        if not aggregate and not re.fullmatch(r'\d{4,18}', upc):
            issues.append(f'Row {line}: the product code must contain 4 to 18 digits.')
            continue
        entries = []
        if texas:
            for idx, name in enumerate(names):
                match = re.fullmatch(r'([a-z]+)_(20\d{2})_paid_(?:amt|amount)', name)
                if not match:
                    continue
                months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
                if match[1][:3] not in months:
                    continue
                p = f'{match[2]}-{months.index(match[1][:3])+1:02d}'
                entries.append({**row, 'period': p, 'category': 'Peanut & seed butter', 'subcategory': section, 'brand': row.get('brand_description') or ('Private Store Brand' if aggregate else None),
                                'paid_amount': values[idx], 'packages': values[idx-1], 'quantity': values[idx-1], 'unit': 'JAR'})
        else:
            entries = [{**row, 'period': clean(row.get('period')) or period}]
        for item in entries:
            try:
                p = period_valid(item['period'])
                category, description = clean(item.get('category')), clean(item.get('description'))
                if not category or not description:
                    raise DataError('The category and description are required.')
                amount = number(item.get('paid_amount'), 'Paid amount')
                packages = number(item.get('packages'), 'Packages', True)
                quantity = number(item.get('quantity'), 'Quantity', True)
                # A missing value is not zero. Never invent prices or quantities.
                brand = clean(item.get('brand')) or 'Unspecified'
                unit = clean(item.get('unit')).upper() or 'Unspecified'
                subcategory = clean(item.get('subcategory'))
                key = (p, upc or str(line), category.casefold(), subcategory.casefold(), unit, clean(item.get('package_size')))
                if key in seen:
                    raise DataError('A duplicate product row exists for this period and category.')
                seen.add(key)
                if brand == 'Unspecified':
                    missing_brand += 1
                if amount < 0:
                    negative += 1
                records.append({'upc': upc, 'category': category, 'subcategory': subcategory, 'brand': brand,
                                'brand_key': brand.casefold(), 'description': description, 'unit': unit,
                                'package_size': clean(item.get('package_size')), 'period': p,
                                'paid_cents': int((amount * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP)),
                                'packages': float(packages) if packages is not None else None,
                                'quantity': float(quantity) if quantity is not None else None,
                                'source_row': line})
            except DataError as error:
                issues.append(f'Row {line}: {error}')
    if issues:
        raise DataError(f'Import stopped. {len(issues)} row errors. ' + ' '.join(issues[:6]))
    if not records:
        raise DataError('The selected sheet has no valid product records.')
    if texas:
        grand = next((r for r in raw if clean(r[0]).lower() == 'grand total'), None)
        if grand is None:
            raise DataError('The Texas report has no grand total. Review the source format.')
        for idx, name in enumerate(names):
            match = re.fullmatch(r'([a-z]+)_(20\d{2})_paid_(?:amt|amount)', name)
            if match:
                months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
                p = f'{match[2]}-{months.index(match[1][:3])+1:02d}'
                expected = int((number(grand[idx], 'Grand total') * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
                actual = sum(r['paid_cents'] for r in records if r['period'] == p)
                if expected != actual:
                    raise DataError(f'The {p} product payments do not match the published grand total.')
    if len(records) > MAX_ROWS:
        raise DataError('The parsed table exceeds the 50,000 record limit.')
    if sum(abs(r['paid_cents']) for r in records) > 9000000000000000:
        raise DataError('The payment totals exceed the supported exact range.')
    notes = ['This report covers recorded redemptions. It does not measure benefit use, unmet need, or current product approval.',
             'Product codes retain their source format. Brand names only combine differences in case and spacing.']
    if missing_brand:
        notes.append(f'{missing_brand:,} records have no brand name. They appear as Unspecified.')
    if numeric_codes:
        notes.append(f'{numeric_codes:,} codes were stored as numbers. Leading zeros cannot be recovered.')
    if skipped:
        notes.append(f'{skipped:,} blank-code or total rows were excluded. Only product rows were imported.')
    if negative:
        notes.append(f'{negative:,} records have negative payments. They remain in all net totals.')
    if state == 'IN' and 'Export Worksheet' in sheets and 'SQL' in sheets:
        notes.append('The workbook query selects 12 food categories. Infant formula and infant fruit and vegetables are outside this extract. This is not all Indiana WIC spending.')
    if texas:
        notes.append('Texas publishes National Brand and Store Brand as brand groups. These are not manufacturer names. Coverage is peanut and seed butter only. Private-label aggregates have no product code and do not count as distinct products.')
    return {'records': records, 'notes': notes, 'quality': {'missing_brand': missing_brand, 'numeric_codes': numeric_codes,
            'skipped_rows': skipped, 'negative_payments': negative}, 'periods': sorted({r['period'] for r in records}),
            'categories': sorted({r['category'] for r in records}), 'total_cents': sum(r['paid_cents'] for r in records)}
