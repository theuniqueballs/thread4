import re
SRC = '/home/z/my-project/upload/THREAD 3.2-EXP-V7 — MIGRATION PACK.txt'
DST = '/home/z/my-project/system/BATCH_HISTORY.tsv'
with open(SRC, encoding='utf-8') as f:
    content = f.read()
# batch history = everything before the first FILENAME delimiter
head = content.split('=== FILENAME: RULES.md ===')[0].rstrip() + '\n'
with open(DST, 'w', encoding='utf-8') as f:
    f.write(head)
print(f'saved {head.count(chr(10))} lines -> {DST}')
