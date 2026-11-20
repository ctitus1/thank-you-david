import re
from datetime import date
from .ingest import read_sheets, clean, DataError


def parse_reference(content, filename, sheet, kind, state, as_of):
    sheets = read_sheets(content, filename)
    if sheet not in sheets:
        raise DataError('Choose a valid worksheet.')
    rows = sheets[sheet]
    if not rows:
        raise DataError('The table is empty.')
    names = [clean(v).lower().replace(' ', '_') for v in rows[0]]
    aliases = {'product_description_and_size':'description', 'category_description':'category',
               'subcategory_description':'subcategory', 'uom':'unit', 'upc_code':'upc', 'brand_name':'brand'}
    # The CA source includes both category codes and descriptions.
    if 'category_description' in names:
        names = ['category_code' if n == 'category' else n for n in names]
    if 'subcategory_description' in names:
        names = ['subcategory_code' if n == 'subcategory' else n for n in names]
    names = [aliases.get(n,n) for n in names]
    if 'upc' not in names:
        raise DataError('The table needs a UPC column.')
    if kind == 'apl':
        try:
            date.fromisoformat(as_of)
        except ValueError:
            raise DataError('Enter the snapshot date as YYYY-MM-DD.')
        if not state:
            raise DataError('Enter the jurisdiction for the approval list.')
    records, seen = [], set()
    for line, values in enumerate(rows[1:],2):
        if not any(v is not None and str(v).strip() for v in values):
            continue
        if isinstance(values[names.index('upc')], (int, float)):
            raise DataError(f'Row {line}: the UPC is numeric. Store product codes as text to retain leading zeros.')
        row = {k:clean(v) for k,v in zip(names, values)}
        upc = row.get('upc','')
        if not re.fullmatch(r'\d{4,18}', upc):
            raise DataError(f'Row {line}: use a text UPC with 4 to 18 digits.')
        key = upc.lstrip('0')
        if key in seen:
            raise DataError(f'Row {line}: the product code appears more than once.')
        seen.add(key)
        records.append({k:row.get(k,'') for k in ['upc','description','category','subcategory','brand','manufacturer','flavor','size','attribute','unit']})
    if not records:
        raise DataError('The table has no product records.')
    return {'records':records, 'notes':['A listing describes this dated snapshot. A missing code is not proof that a product is unapproved.',
            'Catalog attributes come from your file. No manufacturer, flavor, or product attribute is inferred.'], 'periods':[], 'categories':[]}
