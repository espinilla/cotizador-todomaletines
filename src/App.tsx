import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Plus, Save, Download, Users, Search, ShoppingBag, Image as ImageIcon, Settings, RefreshCw, Loader, AlertCircle, Calendar, Hash } from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, setDoc, getDoc } from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyDZdScsyfbFZvJxToBOVatXO42l0kWbRcc",
  authDomain: "todomaletines-cotizar.firebaseapp.com",
  projectId: "todomaletines-cotizar",
  storageBucket: "todomaletines-cotizar.firebasestorage.app",
  messagingSenderId: "992361155942",
  appId: "1:992361155942:web:2cb1d605f3f4e86b8ecca7"
};

// --- INICIALIZACIÓN ROBUSTA ---
let app: any, auth: any, db: any;
try {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Error crítico inicializando Firebase:", e);
}

// --- UTILIDAD PDF ---
declare global { interface Window { jspdf: any; } }
const loadScript = (src: string): Promise<void> => {
  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    document.body.appendChild(script);
  });
};

// --- UTILIDAD FECHAS ---
const getToday = () => new Date().toISOString().split('T')[0];
const getEndOfMonth = () => {
  const date = new Date();
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return lastDay.toISOString().split('T')[0];
};

export default function CotizadorApp() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string>('');
  const [pdfReady, setPdfReady] = useState(false);
  const [activeTab, setActiveTab] = useState('cotizacion'); 
  const fileInputRefs = useRef<{[key: number]: HTMLInputElement | null}>({}); 
  const logoInputRef = useRef<HTMLInputElement>(null);

  // --- DATOS POR DEFECTO ---
  const defaultProfile = {
    name: 'MULTISERVICIOS ANTCOR S.A.C.', 
    ruc: '20607442950',
    address: 'Jiron Amazonas 426 Cercado de Lima, Lima-Perú',
    web: 'www.todomaletines.com',
    email: 'ventas@todomaletines.com',
    phone: '933761658 / 969940986',
    logo: null as string | null,
    quoteCount: '00101', // Contador inicial por defecto
    defaultTerms: `1° El pago será con 50% de anticipo y 50% contraentrega, se dará la verificación del mismo, el abono se realizara a la cuenta BCP 305-9843679-0-06, a nombre Multiservicios Antcor S.A.C. CCI: 00230500984367900611
2° Para dar la conformidad a esta cotización se debe enviar firmada o sellada a nuestro email.
3° La firma o sello indica la aceptación del cliente
4° El costo incluye Brandeado y delivery gratis en Lima metropolitana, las imágenes son referenciales`
  };

  const [companyProfile, setCompanyProfile] = useState(defaultProfile);
  const [clientData, setClientData] = useState({ name: '', ruc: '', address: '', contact: '', email: '', phone: '' });
  
  // FECHAS AUTOMÁTICAS E IGV
  const [quoteMeta, setQuoteMeta] = useState({
    date: getToday(), // Día actual
    validUntil: getEndOfMonth(), // Fin de mes automático
    number: '00101', 
    currency: 'S/', 
    taxRate: 18
  });
  
  const [items, setItems] = useState<any[]>([{ id: 1, code: 'PM348DC', description: 'Cooler nylon forro térmico, logo bordado 12cm, 40*40*40', qty: 570, price: 58.00, image: null }]);
  const [terms, setTerms] = useState(defaultProfile.defaultTerms);
  const [savedClients, setSavedClients] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // --- INICIO ---
  useEffect(() => {
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      .then(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js'))
      .then(() => setPdfReady(true));

    // Cargar Configuración + Contador
    const savedConfig = localStorage.getItem('todoMaletinesConfig');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        const mergedProfile = { ...defaultProfile, ...parsed };
        setCompanyProfile(mergedProfile);
        
        // Sincronizar número de cotización actual con el guardado
        setQuoteMeta(prev => ({
            ...prev,
            number: mergedProfile.quoteCount || '00101',
            date: getToday(),
            validUntil: getEndOfMonth()
        }));

        if (parsed.defaultTerms) setTerms(parsed.defaultTerms);
      } catch (e) { console.error("Error local config"); }
    }

    if (auth) {
        setAuthError('');
        signInAnonymously(auth)
            .catch((error) => setAuthError(`Error: ${error.message}`));
        const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
        return () => unsubscribe();
    } else { setLoading(false); setAuthError("Error DB"); }
  }, []);

  // --- CLIENTES ---
  useEffect(() => {
    if (!user || !db) return;
    const q = collection(db, 'users', user.uid, 'clients');
    return onSnapshot(q, (snap) => {
      setSavedClients(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error(err));
  }, [user]);

  // --- HANDLERS ---
  const calculateTotals = () => {
    let totalWithTax = 0;
    items.forEach(item => totalWithTax += item.qty * item.price);
    
    // Si taxRate es 0, la base es igual al total
    const divisor = 1 + (quoteMeta.taxRate / 100);
    const subtotalBase = totalWithTax / divisor;
    const igv = totalWithTax - subtotalBase;
    
    return { subtotalBase, igv, totalWithTax };
  };

  const handleAddItem = () => setItems([...items, { id: Date.now(), code: '', description: '', qty: 1, price: 0, image: null }]);
  const handleRemoveItem = (id: number) => setItems(items.filter(item => item.id !== id));
  const handleItemChange = (id: number, field: string, value: any) => setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));

  const handleImageUpload = (id: number, e: any) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => handleItemChange(id, 'image', reader.result);
      reader.readAsDataURL(file);
    }
  };
  const removeImage = (id: number) => handleItemChange(id, 'image', null);

  const handleLogoUpload = (e: any) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setCompanyProfile(prev => ({ ...prev, logo: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  const saveClientToDb = async () => {
    if (!auth || !user) return alert("Conectando...");
    try { await addDoc(collection(db, 'users', user.uid, 'clients'), clientData); alert('Cliente guardado.'); } catch (e: any) { alert(`Error: ${e.message}`); }
  };

  // Guardar configuración + Contador actual
  const saveLocalConfig = (newCount?: string) => {
    try {
      const configToSave = { 
          ...companyProfile, 
          defaultTerms: terms,
          quoteCount: newCount || quoteMeta.number // Guardamos el número actual
      };
      localStorage.setItem('todoMaletinesConfig', JSON.stringify(configToSave));
      if(!newCount) alert('Configuración guardada.');
    } catch (e) { alert('Logo muy pesado.'); }
  };

  const updateDefaultTerms = () => { setTerms(defaultProfile.defaultTerms); alert('Restaurado.'); }

  const loadClient = (client: any) => {
    setClientData({
      name: client.name || '', ruc: client.ruc || '', address: client.address || '',
      contact: client.contact || '', email: client.email || '', phone: client.phone || ''
    });
    setActiveTab('cotizacion');
  };

  // Función para incrementar contador (tipo string "00101" -> "00102")
  const incrementQuoteNumber = (current: string) => {
      const num = parseInt(current, 10);
      if (isNaN(num)) return current;
      return String(num + 1).padStart(5, '0'); // Mantiene los ceros a la izquierda
  };

  const generatePDF = () => {
    if (!window.jspdf) return alert("Cargando PDF...");
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const { subtotalBase, igv, totalWithTax } = calculateTotals();

        // LOGO
        if (companyProfile.logo) {
            try {
                const imgProps = doc.getImageProperties(companyProfile.logo);
                const maxWidth = 50; const maxHeight = 25;
                let w = imgProps.width; let h = imgProps.height;
                const ratio = w / h;
                if (w > maxWidth) { w = maxWidth; h = w / ratio; }
                if (h > maxHeight) { h = maxHeight; w = h * ratio; }
                doc.addImage(companyProfile.logo, 'JPEG', 14, 10, w, h);
            } catch (e) { doc.setFontSize(22); doc.text(companyProfile.name, 14, 20); }
        } else {
            doc.setFontSize(22); doc.setTextColor(40, 40, 40); doc.text(companyProfile.name, 14, 20);
        }
        
        doc.setFontSize(9); doc.setTextColor(80, 80, 80);
        let yPos = companyProfile.logo ? 40 : 26;
        doc.text(companyProfile.address || '', 14, yPos);
        doc.text(`RUC: ${companyProfile.ruc || ''}`, 14, yPos + 4);
        doc.text(`Web: ${companyProfile.web || ''}`, 14, yPos + 8);
        doc.text(`Email: ${companyProfile.email || ''}`, 14, yPos + 12);
        doc.text(`Telf: ${companyProfile.phone || ''}`, 14, yPos + 16);

        doc.setDrawColor(200); doc.setFillColor(245, 247, 250);
        doc.rect(120, 15, 75, 30, 'F');
        doc.setFontSize(14); doc.setTextColor(0, 0, 0); doc.text("COTIZACIÓN", 125, 23);
        doc.setFontSize(10);
        doc.text(`Nº: ${quoteMeta.number}`, 125, 30);
        doc.text(`Fecha: ${quoteMeta.date}`, 125, 35);
        doc.text(`Válido hasta: ${quoteMeta.validUntil}`, 125, 40);

        doc.setFillColor(41, 128, 185); doc.rect(14, 60, 180, 7, 'F');
        doc.setFontSize(10); doc.setTextColor(255, 255, 255); doc.setFont(undefined, 'bold');
        doc.text("DATOS DEL CLIENTE", 16, 64.5);
        doc.setTextColor(40, 40, 40); doc.setFont(undefined, 'normal');
        doc.text(`Cliente: ${clientData.name}`, 14, 73);
        doc.text(`RUC: ${clientData.ruc}`, 14, 78);
        doc.text(`Dirección: ${clientData.address}`, 14, 83);
        doc.text(`Contacto: ${clientData.contact}`, 120, 73);
        doc.text(`Email: ${clientData.email}`, 120, 78);
        doc.text(`Telf: ${clientData.phone}`, 120, 83);

        const tableRows = items.map(item => [
          '', item.code, item.description, item.qty,
          `${quoteMeta.currency} ${parseFloat(item.price).toFixed(2)}`,
          `${quoteMeta.currency} ${(item.qty * item.price).toFixed(2)}`
        ]);

        doc.autoTable({
          startY: 90,
          head: [['IMG', 'CÓDIGO', 'DESCRIPCIÓN', 'CANT.', 'PRECIO', 'TOTAL']],
          body: tableRows,
          theme: 'grid',
          headStyles: { fillColor: [41, 128, 185], textColor: 255, valign: 'middle', halign: 'center' },
          styles: { fontSize: 9, cellPadding: 3, valign: 'middle' },
          columnStyles: { 0: { cellWidth: 15, minCellHeight: 15 }, 1: { cellWidth: 20 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 18, halign: 'center' }, 4: { cellWidth: 25, halign: 'right' }, 5: { cellWidth: 25, halign: 'right' } },
          didDrawCell: (data: any) => {
            if (data.column.index === 0 && data.cell.section === 'body') {
               const item = items[data.row.index];
               if (item && item.image) {
                 try {
                     const dim = 10;
                     const x = data.cell.x + (data.cell.width - dim) / 2;
                     const y = data.cell.y + (data.cell.height - dim) / 2;
                     doc.addImage(item.image, 'JPEG', x, y, dim, dim);
                 } catch(err) {}
               }
            }
          }
        });

        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(10);
        doc.text(`Subtotal (Base):`, 140, finalY, { align: 'right' });
        doc.text(`${quoteMeta.currency} ${subtotalBase.toFixed(2)}`, 190, finalY, { align: 'right' });
        doc.text(`IGV (${quoteMeta.taxRate}%):`, 140, finalY + 6, { align: 'right' });
        doc.text(`${quoteMeta.currency} ${igv.toFixed(2)}`, 190, finalY + 6, { align: 'right' });
        doc.setFont(undefined, 'bold');
        doc.text(`TOTAL A PAGAR:`, 140, finalY + 14, { align: 'right' });
        doc.text(`${quoteMeta.currency} ${totalWithTax.toFixed(2)}`, 190, finalY + 14, { align: 'right' });

        doc.setFont(undefined, 'normal'); doc.setFontSize(9);
        doc.text("Términos y Condiciones:", 14, finalY + 25);
        doc.text(doc.splitTextToSize(terms, 180), 14, finalY + 32);
        doc.setFontSize(8); doc.setTextColor(150);
        doc.text(`Gracias por su preferencia - ${companyProfile.name}`, 105, 285, { align: 'center' });

        doc.save(`Cotizacion_${quoteMeta.number}_${clientData.name || 'Cliente'}.pdf`);

        // --- AUTO INCREMENTAR AL FINALIZAR ---
        const nextNum = incrementQuoteNumber(quoteMeta.number);
        setQuoteMeta(prev => ({...prev, number: nextNum})); // Actualiza en pantalla
        saveLocalConfig(nextNum); // Guarda en memoria para la próxima vez

    } catch (error) { alert("Error PDF."); }
  };

  const { subtotalBase, igv, totalWithTax } = calculateTotals();

  if (loading) return <div className="p-10 text-center flex flex-col items-center justify-center h-screen"><Loader className="animate-spin mb-2 text-blue-600"/>Iniciando...</div>;

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50 font-sans overflow-hidden">
      <div className="bg-blue-900 text-white p-4 shadow-md shrink-0 z-20">
        <div className="flex justify-between items-center max-w-4xl mx-auto">
          <h1 className="text-xl font-bold flex items-center gap-2"><ShoppingBag size={20} /> Todo Maletines</h1>
          <button onClick={generatePDF} disabled={!pdfReady} className={`px-3 py-1 rounded-md text-sm font-bold flex items-center gap-1 shadow-sm transition-colors ${!pdfReady ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'}`}>
            {!pdfReady ? <Loader size={16} className="animate-spin"/> : <Download size={16} />} PDF
          </button>
        </div>
      </div>

      <div className="flex bg-white border-b border-gray-200 shrink-0 z-10 overflow-x-auto justify-center">
        <div className="flex w-full max-w-4xl">
           <button onClick={() => setActiveTab('cotizacion')} className={`flex-1 py-3 px-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'cotizacion' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Cotización</button>
           <button onClick={() => setActiveTab('items')} className={`flex-1 py-3 px-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'items' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Productos ({items.length})</button>
           <button onClick={() => setActiveTab('clientes')} className={`flex-1 py-3 px-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'clientes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>Clientes</button>
           <button onClick={() => setActiveTab('config')} className={`flex-1 py-3 px-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === 'config' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}><Settings size={18} className="mx-auto" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 w-full">
        <div className="max-w-4xl mx-auto pb-20">
            {authError && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-xs flex items-center gap-2 border border-red-200"><AlertCircle size={16} /><span>{authError}</span></div>}

            {activeTab === 'cotizacion' && (
              <div className="space-y-6 animate-in fade-in zoom-in duration-300">
                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                  <h3 className="text-gray-500 text-xs font-bold uppercase mb-3">Datos Generales</h3>
                  
                  {/* FILA 1: NUMERO Y SWITCH IGV */}
                  <div className="flex gap-3 mb-3">
                    <div className="flex-1">
                        <label className="text-xs text-gray-500 block mb-1 flex items-center gap-1"><Hash size={12}/> Número</label>
                        <input type="text" value={quoteMeta.number} onChange={(e) => setQuoteMeta({...quoteMeta, number: e.target.value})} className="w-full border-b border-gray-300 focus:border-blue-600 outline-none py-1 text-sm font-mono"/>
                    </div>
                    <div className="flex items-end pb-1">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <div className="relative">
                                <input type="checkbox" className="sr-only peer" checked={quoteMeta.taxRate > 0} onChange={(e) => setQuoteMeta({...quoteMeta, taxRate: e.target.checked ? 18 : 0})} />
                                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                            </div>
                            <span className="text-xs font-medium text-gray-600">{quoteMeta.taxRate > 0 ? 'Con IGV' : 'Sin IGV'}</span>
                        </label>
                    </div>
                  </div>

                  {/* FILA 2: FECHAS */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs text-gray-500 block mb-1 flex items-center gap-1"><Calendar size={12}/> Fecha</label>
                        <input type="date" value={quoteMeta.date} onChange={(e) => setQuoteMeta({...quoteMeta, date: e.target.value})} className="w-full border-b border-gray-300 focus:border-blue-600 outline-none py-1 text-sm"/>
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 block mb-1 flex items-center gap-1"><Calendar size={12}/> Valido Hasta</label>
                        <input type="date" value={quoteMeta.validUntil} onChange={(e) => setQuoteMeta({...quoteMeta, validUntil: e.target.value})} className="w-full border-b border-gray-300 focus:border-blue-600 outline-none py-1 text-sm"/>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 relative">
                  <div className="flex justify-between items-center mb-3"><h3 className="text-gray-500 text-xs font-bold uppercase">Información del Cliente</h3><button onClick={saveClientToDb} className="text-blue-600 text-xs flex items-center gap-1 font-medium hover:bg-blue-50 px-2 py-1 rounded"><Save size={14} /> Guardar</button></div>
                  <div className="space-y-3">
                    <div><label className="text-xs text-gray-400">Nombre / Empresa</label><input type="text" placeholder="Ej. Prodac SAC" value={clientData.name} onChange={(e) => setClientData({...clientData, name: e.target.value})} className="w-full border p-2 rounded text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 outline-none transition-all"/></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-xs text-gray-400">RUC / DNI</label><input type="text" placeholder="2060..." value={clientData.ruc} onChange={(e) => setClientData({...clientData, ruc: e.target.value})} className="w-full border p-2 rounded text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 outline-none"/></div>
                      <div><label className="text-xs text-gray-400">Teléfono</label><input type="tel" placeholder="999..." value={clientData.phone} onChange={(e) => setClientData({...clientData, phone: e.target.value})} className="w-full border p-2 rounded text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 outline-none"/></div>
                    </div>
                    <div><label className="text-xs text-gray-400">Dirección</label><input type="text" placeholder="Av. Principal 123..." value={clientData.address} onChange={(e) => setClientData({...clientData, address: e.target.value})} className="w-full border p-2 rounded text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 outline-none"/></div>
                    <div><label className="text-xs text-gray-400">Contacto</label><input type="text" placeholder="Nombre de la persona" value={clientData.contact} onChange={(e) => setClientData({...clientData, contact: e.target.value})} className="w-full border p-2 rounded text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 outline-none"/></div>
                    <div><label className="text-xs text-gray-400">Email</label><input type="email" placeholder="correo@empresa.com" value={clientData.email} onChange={(e) => setClientData({...clientData, email: e.target.value})} className="w-full border p-2 rounded text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 outline-none"/></div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 relative">
                   <div className="flex justify-between items-center mb-2"><h3 className="text-gray-500 text-xs font-bold uppercase">Términos y Condiciones</h3><button onClick={updateDefaultTerms} className="text-orange-500 text-[10px] flex items-center gap-1 hover:bg-orange-50 px-2 py-1 rounded"><RefreshCw size={12} /> Restaurar Original</button></div>
                   <textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="w-full text-xs text-gray-600 border rounded p-2 h-24 focus:outline-blue-500"/>
                </div>
              </div>
            )}

            {/* SE MANTIENEN LAS DEMÁS PESTAÑAS (ITEMS, CLIENTES, CONFIG) EXACTAMENTE IGUAL */}
            {activeTab === 'items' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                 <div className="flex justify-between items-center bg-blue-50 p-3 rounded-lg border border-blue-100">
                    <div><p className="text-xs text-blue-800 font-bold">TOTAL A PAGAR {quoteMeta.taxRate > 0 ? '(Inc. IGV)' : '(Sin IGV)'}</p><p className="text-xl font-bold text-blue-900">{quoteMeta.currency} {totalWithTax.toFixed(2)}</p></div>
                    <div className="text-right text-xs text-blue-600"><p>Base: {subtotalBase.toFixed(2)}</p><p>IGV: {igv.toFixed(2)}</p></div>
                 </div>
                 {items.map((item, index) => (
                   <div key={item.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 relative">
                      <button onClick={() => handleRemoveItem(item.id)} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 size={18} /></button>
                      <h4 className="text-xs font-bold text-gray-400 mb-2">ITEM #{index + 1}</h4>
                      <div className="flex gap-3 items-start">
                        <div className="w-20 shrink-0 flex flex-col items-center">
                            <div className="w-20 h-20 bg-gray-100 rounded border border-gray-300 flex items-center justify-center overflow-hidden relative cursor-pointer hover:bg-gray-200 transition-colors" onClick={() => fileInputRefs.current?.[item.id]?.click()}>
                              {item.image ? (<img src={item.image} alt="Producto" className="w-full h-full object-cover" />) : (<ImageIcon className="text-gray-400" size={24} />)}
                            </div>
                            <input type="file" ref={el => { if(fileInputRefs.current) fileInputRefs.current[item.id] = el; }} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(item.id, e)}/>
                            {item.image ? (<button onClick={() => removeImage(item.id)} className="text-[10px] text-red-500 mt-1">Quitar</button>) : (<span className="text-[10px] text-blue-500 mt-1 cursor-pointer" onClick={() => fileInputRefs.current?.[item.id]?.click()}>Subir foto</span>)}
                        </div>
                        <div className="flex-1 space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                              <div className="col-span-1"><label className="text-[10px] text-gray-400">Código</label><input value={item.code} onChange={(e) => handleItemChange(item.id, 'code', e.target.value)} className="w-full border-b border-gray-300 py-1 text-sm font-medium focus:border-blue-600 outline-none" placeholder="PM348..."/></div>
                              <div className="col-span-2">
                                <label className="text-[10px] text-gray-400">Precio Unit. {quoteMeta.taxRate > 0 ? '(Inc. IGV)' : ''}</label>
                                <input 
                                  type="number" 
                                  value={item.price}
                                  onFocus={(e) => e.target.select()} 
                                  onChange={(e) => handleItemChange(item.id, 'price', parseFloat(e.target.value) || 0)} 
                                  className="w-full border-b border-gray-300 py-1 text-sm font-bold text-blue-700 focus:border-blue-600 outline-none" 
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                            <div><label className="text-xs text-gray-400">Descripción</label><textarea value={item.description} onChange={(e) => handleItemChange(item.id, 'description', e.target.value)} className="w-full border rounded p-2 text-sm focus:ring-1 focus:ring-blue-400 outline-none h-16" placeholder="Descripción..."/></div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                          <div><label className="text-[10px] text-gray-400 block">Cantidad</label>
                            <div className="flex items-center gap-2"><button onClick={() => handleItemChange(item.id, 'qty', Math.max(1, item.qty - 1))} className="bg-gray-100 w-8 h-8 rounded-full flex items-center justify-center font-bold text-gray-600">-</button>
                            <input 
                                type="number" 
                                value={item.qty} 
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => handleItemChange(item.id, 'qty', parseInt(e.target.value) || 1)} 
                                className="w-16 text-center font-bold text-lg border-b border-gray-300 focus:border-blue-500 outline-none"
                            />
                            <button onClick={() => handleItemChange(item.id, 'qty', item.qty + 1)} className="bg-gray-100 w-8 h-8 rounded-full flex items-center justify-center font-bold text-gray-600">+</button></div>
                          </div>
                          <div className="text-right"><label className="text-[10px] text-gray-400 block">Subtotal</label><span className="text-lg font-bold text-gray-700">{quoteMeta.currency} {(item.qty * item.price).toFixed(2)}</span></div>
                      </div>
                   </div>
                 ))}
                 <button onClick={handleAddItem} className="w-full py-3 border-2 border-dashed border-blue-300 text-blue-500 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors"><Plus size={20} /> Agregar Producto</button>
              </div>
            )}

            {activeTab === 'clientes' && (
              <div className="space-y-4 animate-in fade-in zoom-in duration-300">
                <div className="relative"><Search className="absolute left-3 top-3 text-gray-400" size={18} /><input type="text" placeholder="Buscar cliente..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"/></div>
                {savedClients.length === 0 ? (
                  <div className="text-center py-10 text-gray-400"><Users size={40} className="mx-auto mb-2 opacity-20" /><p>No tienes clientes guardados aún.</p><p className="text-xs">Guarda uno desde la pestaña Cotización.</p></div>
                ) : (
                  <div className="space-y-2">
                    {savedClients.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase())).map(client => (
                      <div key={client.id} onClick={() => loadClient(client)} className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer hover:bg-blue-50 transition-colors">
                        <div><h4 className="font-bold text-gray-800">{client.name}</h4><p className="text-xs text-gray-500">{client.email || 'Sin email'} • {client.phone || 'Sin telf'}</p></div>
                        <button className="text-blue-600 text-xs font-bold border border-blue-200 px-3 py-1 rounded-full">Usar</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'config' && (
                <div className="space-y-6 animate-in fade-in zoom-in duration-300">
                    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                        <h3 className="text-gray-500 text-xs font-bold uppercase mb-4 border-b pb-2">Datos de tu Empresa</h3>
                        <div className="mb-6 flex flex-col items-center">
                            <div className="w-32 h-32 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden cursor-pointer relative" onClick={() => logoInputRef.current?.click()}>
                                {companyProfile.logo ? (<img src={companyProfile.logo} className="w-full h-full object-contain" alt="Logo" />) : (<div className="text-center text-gray-400"><ImageIcon className="mx-auto mb-1" /><span className="text-xs">Subir Logo</span></div>)}
                            </div>
                            <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
                            <button onClick={() => setCompanyProfile(prev => ({...prev, logo: null}))} className="text-red-400 text-xs mt-2">Eliminar Logo</button>
                        </div>
                        <div className="space-y-3">
                            <div><label className="text-xs text-gray-400">Nombre Comercial</label><input value={companyProfile.name} onChange={(e) => setCompanyProfile({...companyProfile, name: e.target.value})} className="w-full border p-2 rounded text-sm outline-none focus:border-blue-500"/></div>
                            <div><label className="text-xs text-gray-400">Dirección</label><input value={companyProfile.address} onChange={(e) => setCompanyProfile({...companyProfile, address: e.target.value})} className="w-full border p-2 rounded text-sm outline-none focus:border-blue-500"/></div>
                            <div><label className="text-xs text-gray-400">RUC</label><input value={companyProfile.ruc} onChange={(e) => setCompanyProfile({...companyProfile, ruc: e.target.value})} className="w-full border p-2 rounded text-sm outline-none focus:border-blue-500"/></div>
                            <div><label className="text-xs text-gray-400">Sitio Web</label><input value={companyProfile.web} onChange={(e) => setCompanyProfile({...companyProfile, web: e.target.value})} className="w-full border p-2 rounded text-sm outline-none focus:border-blue-500"/></div>
                            <div><label className="text-xs text-gray-400">Email</label><input value={companyProfile.email} onChange={(e) => setCompanyProfile({...companyProfile, email: e.target.value})} className="w-full border p-2 rounded text-sm outline-none focus:border-blue-500"/></div>
                            <div><label className="text-xs text-gray-400">Teléfono</label><input value={companyProfile.phone} onChange={(e) => setCompanyProfile({...companyProfile, phone: e.target.value})} className="w-full border p-2 rounded text-sm outline-none focus:border-blue-500"/></div>
                            <div><label className="text-xs text-gray-400">Términos y Condiciones (Por Defecto)</label><textarea value={companyProfile.defaultTerms} onChange={(e) => setCompanyProfile({...companyProfile, defaultTerms: e.target.value})} className="w-full border p-2 rounded text-sm outline-none focus:border-blue-500 h-24"/></div>
                        </div>
                        <button onClick={() => saveLocalConfig()} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold mt-4 shadow-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"><Save size={18} /> Guardar Configuración (En este dispositivo)</button>
                    </div>
                </div>
            )}
        </div>
      </div>
      <div className="text-center text-xs text-gray-400 py-2 bg-gray-50 border-t shrink-0">v3.2 - ANTCOR AVANZADO</div>
    </div>
  );
}
