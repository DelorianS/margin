import { api } from './api.js';
import { h, icon, modal, fill, toast } from './ui.js';

export async function openNetworkGuide() {
  let info;
  try { info = await api.get('/api/network'); }
  catch (e) { toast(e.message, { type: 'error' }); return; }
  const content = h('div', { class: 'stack' });
  const select = h('select', { class: 'select', id: 'network-address', onchange: () => render() },
    info.addresses.map((a, i) => h('option', { value: i }, `${a.name} · ${a.address}`)));
  function render() {
    const address = info.addresses[Number(select.value) || 0];
    fill(content);
    if (!info.enabled) {
      content.append(h('p', null, 'Home-network access is off. Close the current reader server, then double-click start-home-network.bat on your PC.'),
        h('p', { class: 'hint' }, 'Your usual start.bat keeps the reader available only on this PC.'));
    } else if (!address) {
      content.append(h('p', null, 'No home-network address found. Connect your PC to Wi-Fi or Ethernet, then reopen this panel.'));
    } else {
      content.append(h('div', { class: 'field' }, h('label', { for: 'network-address' }, 'PC connection'), select),
        h('div', { class: 'network-url' }, address.url));
      if (info.local) {
        const link = h('input', { class: 'input', id: 'pairing-link', value: address.pairingUrl, readOnly: true, onclick: e => e.target.select() });
        content.append(h('img', { class: 'network-qr', src: address.qr, width: 280, height: 280, alt: `Pairing QR code for ${address.address}` }),
          h('p', null, 'Open Camera on your iPad, point it at this code, and tap the link. Keep this code private: it grants access to your reader.'),
          h('div', { class: 'field' }, h('label', { for: 'pairing-link' }, 'Pairing link'), link, h('span', { class: 'hint' }, 'Click the link field to select it for copying. Pairing codes change when the PC server restarts; scan the new code to reconnect.')));
      } else content.append(h('p', null, 'This device is paired. To connect another device, open this panel on your PC and scan its QR code.'));
    }
  }
  render();
  modal({ title: 'Read on iPad', description: 'Your PC hosts the library and connects to your AI provider. No router setup needed.',
    body: h('div', { class: 'stack' }, content,
      h('div', { class: 'divider' }), h('span', { class: 'eyebrow' }, 'Connection checklist'),
      h('ul', { class: 'network-help' },
        h('li', null, 'Connect both devices to the same home network. The PC can use Ethernet.'),
        h('li', null, 'Keep the PC awake and this reader server running.'),
        h('li', null, 'If it cannot connect, run enable-home-network-firewall.bat on the PC. Windows may ask for a PC administrator password.'),
        h('li', null, 'Use your trusted private network. Guest Wi-Fi may block connections between devices.'),
        h('li', null, 'If there are several addresses, try the Wi-Fi or Ethernet connection used by your iPad.'),
        h('li', null, 'Books, character profiles, and the last chapter are shared. Scroll position, reading preferences, and Ask history stay in each browser.')),
      h('p', { class: 'hint' }, 'Home-network access uses HTTP. Use it only on a trusted home network. The PC’s address can change; reopen this panel for the latest code.')),
    footer: close => h('button', { class: 'btn primary', onclick: close }, 'Done') });
}

export function pairingRequired() {
  return h('main', { class: 'pairing-required stack' }, icon('shield'), h('h1', null, 'Pair your iPad'),
    h('p', null, 'On your PC, open Marginalia → Read on iPad. Scan that QR code with the iPad Camera to access your library.'),
    h('p', { class: 'hint' }, 'If you restarted the PC reader, scan its new code. Both devices must be on the same home network.'),
    h('button', { class: 'btn', onclick: () => location.reload() }, 'Check connection again'));
}
