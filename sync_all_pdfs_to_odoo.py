import os
import re
import xmlrpc.client
import pypdf

# Odoo Credentials
url = "https://prowindows-ltda.odoo.com"
db = "prowindows-ltda"
username = "cristian3877@gmail.com"
api_key = "Up2QaI7FhSmbIq1"
original_template_id = 23941 # Ventana 2 hojas correderas PVC

pdf_dir = r"c:\Users\Usuario\Desktop\codigo 2\pdf a odoo\pdfs"

print("=== CONNECTING TO ODOO ===")
common = xmlrpc.client.ServerProxy(f'{url}/xmlrpc/2/common')
uid = common.authenticate(db, username, api_key, {})
if not uid:
    print("Authentication failed.")
    exit(1)
print("Authenticated successfully, UID:", uid)
models = xmlrpc.client.ServerProxy(f'{url}/xmlrpc/2/object')

attr_ids = {
    'ancho': 16,
    'alto': 17,
    'color': 1,
    'Vidrio': 18
}

def clean_color(c):
    c = c.strip()
    c_lower = c.lower()
    if 'nogal' in c_lower:
        return 'Nogal'
    if 'roble' in c_lower or 'golden' in c_lower:
        return 'Roble dorado'
    return c

def get_client_name(filename):
    name = os.path.splitext(filename)[0]
    name = re.sub(r'^(OFR\d+-\d+|1016-\d+|\d+)\s*', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*(FINAL\s*MODIFICADO|RD)\s*$', '', name, flags=re.IGNORECASE)
    return name.strip().upper()

# --- Parsers ---

def parse_gustavo_format(text):
    items = []
    matches = list(re.finditer(r'Pos\.\s*\d+\s*-\s*(V\d+[a-z]?)', text))
    blocks = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i+1].start() if i + 1 < len(matches) else len(text)
        blocks.append((m.group(1), text[start:end]))
        
    for pos, block in blocks:
        med_match = re.search(r'Ancho:\s*([0-9.,]+)[-\s]+Alto:\s*([0-9.,]+)', block)
        if not med_match:
            continue
        ancho = int(med_match.group(1).replace('.', '').strip())
        alto = int(med_match.group(2).replace('.', '').strip())
        
        color_match = re.search(r'Color:\s*([A-Za-z\s-]+?)(?:Ancho:|$)', block)
        color = clean_color(color_match.group(1)) if color_match else 'Nogal'
        
        glass = '4/9/4 INC'
        glass_match = re.search(r'Vidrios\s*\n([^\n]+)', block)
        if glass_match:
            glass = glass_match.group(1).strip()
            if ' -' in glass:
                glass = glass.split(' -')[0].strip()
        
        qty = 1
        qty_match = re.search(r'UDS:\s*(\d+)', block)
        if qty_match:
            qty = int(qty_match.group(1))
            
        price = 0
        price_lines = block.split('\n')
        for idx, line in enumerate(price_lines):
            if 'UDS:' in line:
                for k in range(idx+1, len(price_lines)):
                    candidate = price_lines[k].replace('.', '').strip()
                    if candidate.isdigit():
                        price = int(candidate)
                        break
                break
        
        items.append({
            'pos': pos,
            'ancho': ancho,
            'alto': alto,
            'color': color,
            'vidrio': glass,
            'qty': qty,
            'price': price
        })
    return items

def parse_sergio_format(text):
    items = []
    blocks = []
    matches = list(re.finditer(r'COMPONENTE\s*\n:\s*\n(V\d+)', text))
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i+1].start() if i + 1 < len(matches) else len(text)
        blocks.append((m.group(1), text[start:end]))
        
    for pos, block in blocks:
        med_match = re.search(r'DIMENSIONES\s*\n:\s*\n(\d+)\s*mm\s*x\s*(\d+)\s*mm', block)
        if not med_match:
            continue
        ancho = int(med_match.group(1))
        alto = int(med_match.group(2))
        
        color_match = re.search(r'COLOR\s*\n:\s*\n([^\n]+)', block)
        color = clean_color(color_match.group(1)) if color_match else 'Nogal'
        
        glass_match = re.search(r'VIDRIOS\s*\n:\s*\n([^\n]+)', block)
        glass = glass_match.group(1).strip() if glass_match else '4/9/4 INC'
        if ' -' in glass:
            glass = glass.split(' -')[0].strip()
            
        qty_match = re.search(r'CANTIDAD\s*\n:\s*\n(\d+)', block)
        qty = int(qty_match.group(1)) if qty_match else 1
        
        price = 0
        price_match = re.search(r'PRECIO UNITARIO\s*\n\$([0-9.]+)', block)
        if price_match:
            price = int(price_match.group(1).replace('.', ''))
            
        items.append({
            'pos': pos,
            'ancho': ancho,
            'alto': alto,
            'color': color,
            'vidrio': glass,
            'qty': qty,
            'price': price
        })
    return items

def parse_roberto_format(text):
    color_match = re.search(r'Color:\s*([A-Za-z0-9\s-]+?)(?:\s*Medida:|$)', text)
    color = clean_color(color_match.group(1)) if color_match else 'Nogal'
    
    med_match = re.search(r'Medida:\s*([0-9.,]+)\s*[xX]\s*([0-9.,]+)', text)
    if not med_match:
        return []
    ancho = int(med_match.group(1).replace('.', '').strip())
    alto = int(med_match.group(2).replace('.', '').strip())
    
    glass = '4/9/4 INC'
    glass_match = re.search(r'Superficies:\s*([^\n]+)', text)
    if glass_match:
        glass = glass_match.group(1).strip()
        if ' -' in glass:
            glass = glass.split(' -')[0].strip()
            
    qty = 1
    price = 0
    price_match = re.search(r'V1(\d+)\$\s*([0-9.]+)', text)
    if price_match:
        qty = int(price_match.group(1))
        price = int(price_match.group(2).replace('.', ''))
        
    return [{
        'pos': 'V1',
        'ancho': ancho,
        'alto': alto,
        'color': color,
        'vidrio': glass,
        'qty': qty,
        'price': price
    }]

def parse_prowindows_format(text):
    items = []
    lines = text.split('\n')
    current_block = []
    for line in lines:
        current_block.append(line)
        if "Pos: V" in line:
            block = "\n".join(current_block)
            current_block = []
            
            pos_match = re.search(r'Pos:\s*(V\d+)', line)
            med_match = re.search(r'Medidas:\s*([0-9.,]+)\s*mm\s*[xX]\s*([0-9.,]+)\s*mm', line, re.IGNORECASE)
            if not med_match:
                med_match = re.search(r'([0-9.,]+)\s*mm\s*[xX]\s*([0-9.,]+)\s*mm', line, re.IGNORECASE)
            
            if pos_match and med_match:
                pos = pos_match.group(1)
                ancho = int(med_match.group(1).replace('.', '').strip())
                alto = int(med_match.group(2).replace('.', '').strip())
                
                color_match = re.search(r'Color:\s*([^\n\t]+?)(?:\s+Unidades:|\s{2,}|\t|Unidades|$)', block, re.IGNORECASE)
                color = clean_color(color_match.group(1)) if color_match else "Roble dorado"
                
                glass_match = re.search(r'Acristalamiento\s*([^\n\t]+?)(?:\s+Sin|\s+Precio|\s+Importe|\s{2,}|\t|$)', block, re.IGNORECASE)
                glass = glass_match.group(1).strip() if glass_match else "4/9/4 INC"
                
                qty_match = re.search(r'Unidades:\s*(\d+)', block, re.IGNORECASE)
                qty = int(qty_match.group(1)) if qty_match else 1
                
                price = 0
                price_match = re.search(r'TOTALUnidadesImporte /Uds\s*\n\s*\d+\s*\$([0-9.,]+)', block, re.IGNORECASE)
                if not price_match:
                    prices = re.findall(r'\$([0-9.]+)', block)
                    price = int(prices[-1].replace('.', '')) if prices else 0
                else:
                    price = int(price_match.group(1).replace('.', ''))
                
                items.append({
                    'pos': pos,
                    'ancho': ancho,
                    'alto': alto,
                    'color': color,
                    'vidrio': glass,
                    'qty': qty,
                    'price': price
                })
    return items

# Dynamic partitioning algorithm to keep Cartesian product size below Odoo's variant limits
def partition_items(items, max_cartesian=800):
    partitions = []
    current_partition = []
    
    for item in items:
        test_partition = current_partition + [item]
        u_ancho = set(i['ancho'] for i in test_partition)
        u_alto = set(i['alto'] for i in test_partition)
        u_color = set(i['color'] for i in test_partition)
        u_vidrio = set(i['vidrio'] for i in test_partition)
        
        cartesian_size = len(u_ancho) * len(u_alto) * len(u_color) * len(u_vidrio)
        if cartesian_size <= max_cartesian:
            current_partition.append(item)
        else:
            partitions.append(current_partition)
            current_partition = [item]
            
    if current_partition:
        partitions.append(current_partition)
        
    return partitions

pdf_configs = [
    {"file": "1016-2 ROBERTO ESPEJO.pdf", "parser": parse_roberto_format},
    {"file": "2589 SERGIO CORTÉS FINAL MODIFICADO.pdf", "parser": parse_sergio_format},
    {"file": "OFR2026-154 ALEJANDRO GALLEGOS.pdf", "parser": parse_prowindows_format},
    {"file": "OFR2026-8 GUSTAVO BRESKY.pdf", "parser": parse_gustavo_format},
    {"file": "OFR2026-92 CRISTIAN CASTRO.pdf", "parser": parse_gustavo_format},
]

# Process each readable PDF
for config in pdf_configs:
    filename = config["file"]
    filepath = os.path.join(pdf_dir, filename)
    if not os.path.exists(filepath):
        print(f"Skipping {filename} (File not found)")
        continue
        
    client_name = get_client_name(filename)
    
    # Extract text and parse items
    reader = pypdf.PdfReader(filepath)
    text = ""
    for idx, page in enumerate(reader.pages):
        text += f"\n--- PAGE {idx+1} ---\n" + (page.extract_text() or "")
        
    parsed_items = config["parser"](text)
    if not parsed_items:
        print(f"No items parsed from {filename}. Skipping Odoo update.")
        continue
    print(f"\nSuccessfully parsed {len(parsed_items)} items from {filename}.")
    
    # Partition items if they would trigger variant limit errors
    partitions = partition_items(parsed_items, max_cartesian=800)
    print(f"Split items into {len(partitions)} partition(s).")
    
    for p_idx, partition in enumerate(partitions):
        # Determine suffix name if partitioned
        suffix = f" {chr(65 + p_idx)}" if len(partitions) > 1 else ""
        template_name = f"Ventana 2 hojas correderas PVC - {client_name}{suffix}"
        
        print(f"\n  -> Syncing Template: '{template_name}' ({len(partition)} items)")
        
        # Unique values
        unique_vals = {
            'ancho': sorted(list(set(str(item['ancho']) for item in partition)), key=int),
            'alto': sorted(list(set(str(item['alto']) for item in partition)), key=int),
            'color': sorted(list(set(item['color'] for item in partition))),
            'Vidrio': sorted(list(set(item['vidrio'] for item in partition)))
        }
        
        # 1. Resolve template ID
        tmpl = models.execute_kw(db, uid, api_key, 'product.template', 'search_read', [[['name', '=', template_name]]], {'fields': ['id', 'attribute_line_ids']})
        
        if tmpl:
            tmpl_id = tmpl[0]['id']
            print(f"     Template already exists (ID {tmpl_id}).")
        else:
            print(f"     Duplicating template {original_template_id} to create '{template_name}'...")
            tmpl_id = models.execute_kw(db, uid, api_key, 'product.template', 'copy', [original_template_id, {'name': template_name}])
            if isinstance(tmpl_id, list):
                tmpl_id = tmpl_id[0]
            print(f"     Created template ID {tmpl_id}.")
            
        # Read attribute lines of new template
        tmpl_info = models.execute_kw(db, uid, api_key, 'product.template', 'read', [[tmpl_id]], {'fields': ['attribute_line_ids']})[0]
        line_ids = tmpl_info['attribute_line_ids']
        lines = models.execute_kw(db, uid, api_key, 'product.template.attribute.line', 'read', [line_ids], {'fields': ['id', 'attribute_id']})
        attr_to_line = {l['attribute_id'][0]: l['id'] for l in lines}
        
        # 2. Ensure attribute values exist and link to template
        value_mappings = {}
        for attr_name, attr_id in attr_ids.items():
            value_mappings[attr_name] = {}
            existing_vals = models.execute_kw(db, uid, api_key, 'product.attribute.value', 'search_read', 
                                              [[['attribute_id', '=', attr_id]]], 
                                              {'fields': ['id', 'name']})
            existing_map = {v['name']: v['id'] for v in existing_vals}
            
            for val in unique_vals[attr_name]:
                if val in existing_map:
                    value_mappings[attr_name][val] = existing_map[val]
                else:
                    new_val_id = models.execute_kw(db, uid, api_key, 'product.attribute.value', 'create', [{
                        'attribute_id': attr_id,
                        'name': val
                    }])
                    value_mappings[attr_name][val] = new_val_id
                    print(f"       Created attribute value '{val}' for '{attr_name}' (ID {new_val_id}).")
                    
            val_ids = list(value_mappings[attr_name].values())
            line_id = attr_to_line.get(attr_id)
            if line_id:
                models.execute_kw(db, uid, api_key, 'product.template.attribute.line', 'write', [[line_id], {
                    'value_ids': [[6, 0, val_ids]]
                }])
                
        print("     Linked attribute values to new template attribute lines.")
        
        # Set template price to 0
        models.execute_kw(db, uid, api_key, 'product.template', 'write', [[tmpl_id], {'list_price': 0.0}])
        
        # 3. Resolve generated variants
        variants = models.execute_kw(db, uid, api_key, 'product.product', 'search_read', 
                                     [[['product_tmpl_id', '=', tmpl_id]]], 
                                     {'fields': ['id', 'product_template_attribute_value_ids', 'default_code']})
        print(f"     Odoo generated {len(variants)} variants.")
        
        ptav_ids = list(set(ptav_id for v in variants for ptav_id in v['product_template_attribute_value_ids']))
        ptav_map = {}
        if ptav_ids:
            ptav_details = models.execute_kw(db, uid, api_key, 'product.template.attribute.value', 'read', 
                                             [ptav_ids], 
                                             {'fields': ['id', 'name', 'attribute_id']})
            for ptav in ptav_details:
                ptav_map[ptav['id']] = (ptav['attribute_id'][1], ptav['name'])
                
        # Delete existing pricelist rules for these variants in Default Pricelist ID 1
        variant_ids = [v['id'] for v in variants]
        existing_items = models.execute_kw(db, uid, api_key, 'product.pricelist.item', 'search', [
            [['pricelist_id', '=', 1], ['product_id', 'in', variant_ids]]
        ])
        if existing_items:
            models.execute_kw(db, uid, api_key, 'product.pricelist.item', 'unlink', [existing_items])
            
        # Match & configure each variant
        updated_count = 0
        inactive_count = 0
        
        for var in variants:
            attrs = {}
            for ptav_id in var['product_template_attribute_value_ids']:
                if ptav_id in ptav_map:
                    attr_name, val_name = ptav_map[ptav_id]
                    attrs[attr_name.lower()] = val_name
                    
            ancho = int(attrs.get('ancho', 0))
            alto = int(attrs.get('alto', 0))
            color = attrs.get('color', '')
            vidrio = attrs.get('vidrio', '')
            
            match = None
            for item in partition:
                if item['ancho'] == ancho and item['alto'] == alto and item['color'] == color and item['vidrio'] == vidrio:
                    match = item
                    break
                    
            if match:
                pos = match['pos']
                price = match['price']
                code = f"{pos} {ancho}x{alto} {color} {vidrio}"
                models.execute_kw(db, uid, api_key, 'product.product', 'write', [[var['id']], {
                    'default_code': code,
                    'standard_price': price
                }])
                models.execute_kw(db, uid, api_key, 'product.pricelist.item', 'create', [{
                    'pricelist_id': 1,
                    'applied_on': '0_product_variant',
                    'product_id': var['id'],
                    'compute_price': 'fixed',
                    'fixed_price': price
                }])
                updated_count += 1
            else:
                code = f"INACTIVO {ancho}x{alto} {color} {vidrio}"
                models.execute_kw(db, uid, api_key, 'product.product', 'write', [[var['id']], {
                    'default_code': code,
                    'standard_price': 0.0
                }])
                inactive_count += 1
                
        print(f"     Configured variants: {updated_count} active (cost & pricelist rules set), {inactive_count} inactive set to $0.")

# Log scanned PDF warning
print("\n==================================================")
print("WARNING: '10 EDUARDO RAMOS.pdf' is scanned (non-searchable text).")
print("This file requires manual creation or OCR processing.")
print("==================================================")
