import xmlrpc.client
import pypdf
import re

# Odoo Credentials
url = "https://prowindows-ltda.odoo.com"
db = "prowindows-ltda"
username = "cristian3877@gmail.com"
api_key = "Up2QaI7FhSmbIq1"
template_id = 23941 # Ventana 2 hojas correderas PVC

print("=== STEP 1: PARSING PDF ===")
reader = pypdf.PdfReader("OFR2025-152 CRISTIAN CASTRO RD.pdf")
full_text = ""
for page in reader.pages:
    full_text += page.extract_text() + "\n"

lines = full_text.split('\n')
parsed_items = []
current_desc = []

for idx, line in enumerate(lines):
    current_desc.append(line)
    if "Pos: V" in line:
        desc_block = "\n".join(current_desc)
        current_desc = []
        
        # Parse Pos and Medidas
        pos_match = re.search(r'Pos:\s*(V\d+)', line)
        med_match = re.search(r'Medidas:\s*([0-9.,]+)mm\s*X\s*([0-9.,]+)mm', line, re.IGNORECASE)
        
        if pos_match and med_match:
            pos = pos_match.group(1)
            ancho_str = med_match.group(1).replace('.', '').strip()
            alto_str = med_match.group(2).replace('.', '').strip()
            
            # Extract color
            color_match = re.search(r'Color:\s*([^\n\t]+?)\s*Unidades:', desc_block, re.IGNORECASE)
            color = color_match.group(1).strip() if color_match else "Roble dorado"
            if color == "Golden Oak":
                color = "Roble dorado"
            
            # Extract glass/acristalamiento
            glass_match = re.search(r'Acristalamiento\s*([^\n\t]+?)\s*(?:Sin|Precio|Importe|$)', desc_block, re.IGNORECASE)
            glass = glass_match.group(1).strip() if glass_match else "4/9/4 INC"
            
            # Extract price
            price_match = re.search(r'TOTALUnidadesImporte /Uds\s*\n\s*\d+\s*\$([0-9.,]+)', desc_block, re.IGNORECASE)
            if not price_match:
                prices = re.findall(r'\$([0-9.]+)', desc_block)
                price = int(prices[-1].replace('.', '')) if prices else 0
            else:
                price = int(price_match.group(1).replace('.', ''))
            
            # Quantity
            qty_match = re.search(r'Unidades:\s*(\d+)', desc_block, re.IGNORECASE)
            qty = int(qty_match.group(1)) if qty_match else 1
            
            parsed_items.append({
                'pos': pos,
                'ancho': int(ancho_str),
                'alto': int(alto_str),
                'color': color,
                'vidrio': glass,
                'price': price,
                'qty': qty
            })

print(f"Parsed {len(parsed_items)} items from PDF:")
for item in parsed_items:
    print(f"  - {item['pos']}: {item['ancho']}x{item['alto']} mm, Color: {item['color']}, Glass: {item['vidrio']}, Price: ${item['price']}")


print("\n=== STEP 2: CONNECTING TO ODOO ===")
common = xmlrpc.client.ServerProxy(f'{url}/xmlrpc/2/common')
uid = common.authenticate(db, username, api_key, {})
if not uid:
    print("Failed to authenticate with Odoo.")
    exit(1)
print("Authenticated successfully, UID:", uid)
models = xmlrpc.client.ServerProxy(f'{url}/xmlrpc/2/object')


print("\n=== STEP 3: ENSURING ATTRIBUTES EXIST ===")
# Attributes mapping: name -> ID
attr_ids = {
    'ancho': 16,
    'alto': 17,
    'color': 1,
    'Vidrio': 18
}

# Ensure attribute values exist in Odoo and get their value IDs
# We gather all unique values for each attribute from the parsed items
unique_values = {
    'ancho': sorted(list(set(str(item['ancho']) for item in parsed_items)), key=int),
    'alto': sorted(list(set(str(item['alto']) for item in parsed_items)), key=int),
    'color': sorted(list(set(item['color'] for item in parsed_items))),
    'Vidrio': sorted(list(set(item['vidrio'] for item in parsed_items)))
}

value_mappings = {} # {attr_name: {value_name: value_id}}

for attr_name, attr_id in attr_ids.items():
    value_mappings[attr_name] = {}
    print(f"Checking values for attribute '{attr_name}' (ID {attr_id})...")
    
    # Read existing values
    existing_vals = models.execute_kw(db, uid, api_key, 'product.attribute.value', 'search_read', 
                                      [[['attribute_id', '=', attr_id]]], 
                                      {'fields': ['id', 'name']})
    existing_map = {v['name']: v['id'] for v in existing_vals}
    
    for val in unique_values[attr_name]:
        if val in existing_map:
            value_mappings[attr_name][val] = existing_map[val]
            print(f"  Value '{val}' already exists with ID {existing_map[val]}.")
        else:
            new_val_id = models.execute_kw(db, uid, api_key, 'product.attribute.value', 'create', [{
                'attribute_id': attr_id,
                'name': val
            }])
            value_mappings[attr_name][val] = new_val_id
            print(f"  Created value '{val}' with ID {new_val_id}.")


print("\n=== STEP 4: LINKING ATTRIBUTES TO THE PRODUCT TEMPLATE ===")
# Get existing attribute lines on template 23941
template_info = models.execute_kw(db, uid, api_key, 'product.template', 'read', 
                                  [[template_id]], 
                                  {'fields': ['id', 'attribute_line_ids']})[0]
existing_lines = {}
if template_info['attribute_line_ids']:
    lines = models.execute_kw(db, uid, api_key, 'product.template.attribute.line', 'read', 
                              [template_info['attribute_line_ids']], 
                              {'fields': ['id', 'attribute_id', 'value_ids']})
    for l in lines:
        existing_lines[l['attribute_id'][0]] = l

for attr_name, attr_id in attr_ids.items():
    val_ids = list(value_mappings[attr_name].values())
    if attr_id in existing_lines:
        line_id = existing_lines[attr_id]['id']
        print(f"Updating attribute line for '{attr_name}' (Line ID {line_id})...")
        models.execute_kw(db, uid, api_key, 'product.template.attribute.line', 'write', 
                          [[line_id], {
                              'value_ids': [[6, 0, val_ids]]
                          }])
    else:
        print(f"Creating attribute line for '{attr_name}'...")
        new_line_id = models.execute_kw(db, uid, api_key, 'product.template.attribute.line', 'create', [{
            'product_tmpl_id': template_id,
            'attribute_id': attr_id,
            'value_ids': [[6, 0, val_ids]]
        }])
        print(f"  Created attribute line ID {new_line_id}.")


print("\n=== STEP 5: RETRIEVING GENERATED VARIANTS ===")
# We read the variants of template 23941
variants = models.execute_kw(db, uid, api_key, 'product.product', 'search_read', 
                             [[['product_tmpl_id', '=', template_id]]], 
                             {'fields': ['id', 'product_template_attribute_value_ids', 'default_code', 'lst_price', 'standard_price']})
print(f"Odoo generated {len(variants)} variants.")

# We need to resolve the attribute values of each variant
# product_template_attribute_value_ids maps to product.template.attribute.value records
# We gather all product.template.attribute.value IDs to read them in a single batch
ptav_ids = []
for var in variants:
    ptav_ids.extend(var['product_template_attribute_value_ids'])
ptav_ids = list(set(ptav_ids))

print(f"Reading {len(ptav_ids)} product template attribute values details...")
ptav_details = models.execute_kw(db, uid, api_key, 'product.template.attribute.value', 'read', 
                                 [ptav_ids], 
                                 {'fields': ['id', 'name', 'attribute_id']})

# Maps ptav_id -> {attr_name, value_name}
ptav_map = {}
for ptav in ptav_details:
    attr_name = ptav['attribute_id'][1] # e.g. "ancho"
    val_name = ptav['name'] # e.g. "315"
    ptav_map[ptav['id']] = (attr_name, val_name)

# Match variants and update
print("\n=== STEP 6: UPDATING PRODUCT VARIANTS ===")

# Delete any existing pricelist items for these variants in the Default pricelist (ID 1)
variant_ids = [var['id'] for var in variants]
existing_items = models.execute_kw(db, uid, api_key, 'product.pricelist.item', 'search', [
    [['pricelist_id', '=', 1], ['product_id', 'in', variant_ids]]
])
if existing_items:
    print(f"Deleting {len(existing_items)} existing pricelist items for these variants...")
    models.execute_kw(db, uid, api_key, 'product.pricelist.item', 'unlink', [existing_items])

# Set template base price to 0
models.execute_kw(db, uid, api_key, 'product.template', 'write', [[template_id], {'list_price': 0.0}])
print("Reset product template base price to $0.0.")

updated_count = 0
inactive_count = 0

for var in variants:
    # Resolve variant attributes
    resolved_attr = {}
    for ptav_id in var['product_template_attribute_value_ids']:
        if ptav_id in ptav_map:
            attr_name, val_name = ptav_map[ptav_id]
            resolved_attr[attr_name] = val_name
            
    # Normalize attributes
    ancho = int(resolved_attr.get('ancho', 0))
    alto = int(resolved_attr.get('alto', 0))
    color = resolved_attr.get('color', '')
    vidrio = resolved_attr.get('Vidrio', '')
    
    # Search for matching parsed item
    match = None
    for item in parsed_items:
        if item['ancho'] == ancho and item['alto'] == alto and item['color'] == color and item['vidrio'] == vidrio:
            match = item
            break
            
    if match:
        pos = match['pos']
        price = match['price']
        code = f"{pos} {ancho}x{alto} {color} {vidrio}"
        print(f"Variant ID {var['id']}: Matches parsed item {pos} ({ancho}x{alto} {color} {vidrio}). Cost: ${price}, Price: ${price}")
        
        # Write code and cost to variant
        models.execute_kw(db, uid, api_key, 'product.product', 'write', 
                          [[var['id']], {
                              'default_code': code,
                              'standard_price': price
                          }])
        
        # Create pricelist item for variant price
        models.execute_kw(db, uid, api_key, 'product.pricelist.item', 'create', [{
            'pricelist_id': 1,
            'applied_on': '0_product_variant',
            'product_id': var['id'],
            'compute_price': 'fixed',
            'fixed_price': price
        }])
        updated_count += 1
    else:
        # Inactive/unused combination (part of Cartesian product but not in PDF quote)
        code = f"INACTIVO {ancho}x{alto} {color} {vidrio}"
        models.execute_kw(db, uid, api_key, 'product.product', 'write', 
                          [[var['id']], {
                              'default_code': code,
                              'standard_price': 0.0
                          }])
        inactive_count += 1

print(f"\nDone! Configured {updated_count} active variants with cost & pricelist items, and set {inactive_count} inactive variants to $0.")
