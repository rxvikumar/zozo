with open('src/chat/ChatSidebarProvider.ts', 'r', encoding='utf-8') as f:
    content = f.read()
    start = content.find('<!DOCTYPE html>')
    end = content.find('`', start)
    html = content[start:end]
    with open('test.html', 'w', encoding='utf-8') as out:
        out.write(html)
