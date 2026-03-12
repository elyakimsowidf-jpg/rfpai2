const { useState, useEffect, useRef, useCallback } = React;

const WIZARD_STEPS = [
  { key: 'upload', label: 'Upload', labelHe: 'העלאה' },
  { key: 'analyze', label: 'Analyze', labelHe: 'ניתוח' },
  { key: 'research', label: 'Research', labelHe: 'מחקר שוק' },
  { key: 'toc', label: 'TOC', labelHe: 'תוכן עניינים' },
  { key: 'sections', label: 'Sections', labelHe: 'סעיפים' },
  { key: 'save', label: 'Save', labelHe: 'שמירה' },
];

function App() {
  // ===================== STATE =====================
  const [wizardStep, setWizardStep] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [createdFiles, setCreatedFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [newVersionName, setNewVersionName] = useState('');
  const [draftName, setDraftName] = useState('');
  const [outputFormat, setOutputFormat] = useState('pdf');
  const [isChatCollapsed, setIsChatCollapsed] = useState(true);
  const [projectGoal, setProjectGoal] = useState('');

  // Zoom
  const [zoomLevel, setZoomLevel] = useState(100);

  // Improvement flow
  const [isImproving, setIsImproving] = useState(false);
  const [improvementStep, setImprovementStep] = useState('');
  const [improvementLogs, setImprovementLogs] = useState([]);
  const [improvementTable, setImprovementTable] = useState([]);
  const [improveWorkflowId, setImproveWorkflowId] = useState('');
  const [originalTocItems, setOriginalTocItems] = useState([]);

  // Section chat
  const [selectedRowIndex, setSelectedRowIndex] = useState(-1);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Market research
  const [marketResearchGoal, setMarketResearchGoal] = useState('');
  const [isMarketResearchLoading, setIsMarketResearchLoading] = useState(false);
  const [marketResearchMarkdown, setMarketResearchMarkdown] = useState('');
  const [marketResearchError, setMarketResearchError] = useState('');
  const [marketResearchWorkflowId, setMarketResearchWorkflowId] = useState('');

  // TOC recommendations
  const [tocRecommendations, setTocRecommendations] = useState('');
  const [isRecsLoading, setIsRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState('');
  const [recsChatMessages, setRecsChatMessages] = useState([]);
  const [recsChatInput, setRecsChatInput] = useState('');
  const [isRecsChatLoading, setIsRecsChatLoading] = useState(false);
  const [recsJustUpdated, setRecsJustUpdated] = useState(false);

  // TOC generation
  const [isTocLoading, setIsTocLoading] = useState(false);
  const [tocError, setTocError] = useState('');
  const [tocModificationRow, setTocModificationRow] = useState(null);
  const [tocSectionRows, setTocSectionRows] = useState([]);
  const [tocOriginalBaselineText, setTocOriginalBaselineText] = useState('');
  const [tocNewToc, setTocNewToc] = useState([]);
  const [tocOriginalToc, setTocOriginalToc] = useState([]);
  const [tocPanelJustUpdated, setTocPanelJustUpdated] = useState(false);

  // TOC chat
  const [tocChatMessages, setTocChatMessages] = useState([]);
  const [tocChatInput, setTocChatInput] = useState('');
  const [isTocChatLoading, setIsTocChatLoading] = useState(false);

  // Section creation
  const [currentSectionIndex, setCurrentSectionIndex] = useState(-1);
  const [isSectionLoading, setIsSectionLoading] = useState(false);
  const [sectionError, setSectionError] = useState('');
  const [sectionWorkflowId, setSectionWorkflowId] = useState('');
  const [flashRowIndex, setFlashRowIndex] = useState(-1);

  // Collapsible sections
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [researchCollapsed, setResearchCollapsed] = useState(false);

  // Loading status messages
  const [loadingStatus, setLoadingStatus] = useState('');
  const loadingIntervalRef = useRef(null);

  const chatEndRef = useRef(null);

  // ===================== FETCH HELPERS =====================
  const fetchUploadedFiles = async () => {
    try {
      const res = await fetch('/api/uploads');
      const data = await res.json();
      setUploadedFiles(data.files || []);
    } catch (e) { console.error(e); }
  };

  const fetchCreatedFiles = async () => {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      setCreatedFiles(data.files || []);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchUploadedFiles(); fetchCreatedFiles(); }, [wizardStep]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, tocChatMessages, recsChatMessages]);

  // Auto-start analysis when entering step 1 with a selected file
  useEffect(() => {
    if (wizardStep === 1 && selectedFile && !isImproving && improvementTable.length === 0) {
      handleLoadAndProcess();
    }
  }, [wizardStep]);

  const buildOutputFilename = (name, format) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return '';
    const base = trimmed.replace(/\.(pdf|docx|md)$/i, '');
    return `${base}.${format}`;
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const startLoadingMessages = (messages, intervalMs = 3000) => {
    let idx = 0;
    setLoadingStatus(messages[0]);
    if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
    loadingIntervalRef.current = setInterval(() => {
      idx = Math.min(idx + 1, messages.length - 1);
      setLoadingStatus(messages[idx]);
    }, intervalMs);
  };

  const stopLoadingMessages = () => {
    if (loadingIntervalRef.current) { clearInterval(loadingIntervalRef.current); loadingIntervalRef.current = null; }
    setLoadingStatus('');
  };

  const fetchWorkflowJson = async (url, options = {}) => {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok && !data.workflow_id) throw new Error(data.error || 'Workflow request failed');
    return data;
  };

  const advanceWorkflow = async (workflowId) => {
    return fetchWorkflowJson(`/api/workflows/${encodeURIComponent(workflowId)}/advance`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
  };

  // ===================== WORKFLOW SYNC =====================
  const syncImproveWorkflowState = (workflow) => {
    const logs = workflow.progress_messages || [];
    const result = workflow.result || {};
    const items = result.table || [];
    const latestStep = logs[logs.length - 1] || workflow.phase || '\u05DE\u05E2\u05D1\u05D3...';
    setImproveWorkflowId(workflow.workflow_id || '');
    setImprovementStep(latestStep);
    setImprovementLogs(logs);
    setIsImproving(workflow.status === 'pending' || workflow.status === 'running');
    if (items.length > 0) {
      setImprovementTable(items);
      setEditorContent(items.map(r => `## ${r.section_title}\n\n${r.summary}`).join('\n\n'));
    }
    if (result.toc_items) setOriginalTocItems(result.toc_items);
  };

  const syncMarketResearchWorkflowState = (workflow) => {
    const result = workflow.result || {};
    setMarketResearchWorkflowId(workflow.workflow_id || '');
    setIsMarketResearchLoading(workflow.status === 'pending' || workflow.status === 'running');
    if (result.markdown) setMarketResearchMarkdown(result.markdown);
  };

  const syncSectionWorkflowState = (workflow) => {
    const result = workflow.result || {};
    const rows = result.section_rows || [];
    setSectionWorkflowId(workflow.workflow_id || '');
    setCurrentSectionIndex(
      workflow.status === 'completed' ? rows.length
        : (typeof workflow.current_section_index === 'number' ? workflow.current_section_index : -1)
    );
    if (rows.length > 0) {
      setTocSectionRows(prev => rows.map((row, i) => {
        const prevRow = prev[i];
        if (prevRow && prevRow.improvedText && prevRow.improvedText !== row.improvedText) {
          return { ...row, improvedText: prevRow.improvedText, explanation: prevRow.explanation || row.explanation };
        }
        return row;
      }));
    }
  };

  const runWorkflowToCompletion = async (createUrl, body, onUpdate) => {
    let workflow = await fetchWorkflowJson(createUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    onUpdate(workflow);
    while (workflow.status === 'pending' || workflow.status === 'running') {
      workflow = await advanceWorkflow(workflow.workflow_id);
      onUpdate(workflow);
      if (workflow.status === 'pending' || workflow.status === 'running') await sleep(50);
    }
    return workflow;
  };

  // ===================== UPLOAD HANDLERS =====================
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      await fetch('/api/upload', { method: 'POST', body: formData });
      fetchUploadedFiles();
    } catch (e) { alert('\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D4\u05E2\u05DC\u05D0\u05EA \u05D4\u05E7\u05D5\u05D1\u05E5'); }
  };

  const handleDeleteUpload = async (filename) => {
    if (!confirm(`\u05DC\u05DE\u05D7\u05D5\u05E7 \u05D0\u05EA ${filename}?`)) return;
    try {
      await fetch(`/api/uploads/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      fetchUploadedFiles();
    } catch (e) { console.error(e); }
  };

  const handleSelectFile = (e) => {
    const filename = e.target.value;
    setSelectedFile(filename);
    if (!filename) { setDraftName(''); return; }
    setDraftName(`new-${filename.replace(/\.[^/.]+$/, "")}`);
  };

  // ===================== ANALYZE (IMPROVE) =====================
  const handleLoadAndProcess = async () => {
    if (!selectedFile) { alert("\u05D0\u05E0\u05D0 \u05D1\u05D7\u05E8\u05D5 \u05E7\u05D5\u05D1\u05E5 \u05E9\u05D4\u05D5\u05E2\u05DC\u05D4."); return; }
    setImprovementTable([]); setEditorContent(''); setIsImproving(true);
    setImprovementStep("\u05DE\u05EA\u05D7\u05D9\u05DC \u05EA\u05D4\u05DC\u05D9\u05DA \u05E0\u05D9\u05EA\u05D5\u05D7 \u05DE\u05E1\u05DE\u05DA...");
    setImprovementLogs(["\u05DE\u05EA\u05D7\u05D9\u05DC \u05EA\u05D4\u05DC\u05D9\u05DA \u05E0\u05D9\u05EA\u05D5\u05D7 \u05DE\u05E1\u05DE\u05DA..."]);
    setSelectedRowIndex(-1); setChatMessages([]);
    setMarketResearchMarkdown(''); setMarketResearchError('');
    setTocRecommendations(''); setRecsError(''); setRecsChatMessages([]);
    setTocError(''); setTocModificationRow(null); setTocOriginalBaselineText('');
    setTocSectionRows([]); setTocNewToc([]); setTocOriginalToc([]);
    setTocChatMessages([]); setCurrentSectionIndex(-1);
    setIsSectionLoading(false); setSectionError('');
    setImproveWorkflowId(''); setMarketResearchWorkflowId(''); setSectionWorkflowId('');
    setOriginalTocItems([]);
    const baseName = selectedFile.replace(/\.[^/.]+$/, "");
    setNewVersionName(`new-${baseName}`);
    if (!draftName) setDraftName(`new-${baseName}`);
    try {
      const workflow = await runWorkflowToCompletion('/api/improve', { filename: selectedFile }, syncImproveWorkflowState);
      if (workflow.status === 'failed') throw new Error(workflow.last_error || 'Error processing document');
      setImprovementStep('\u05EA\u05D4\u05DC\u05D9\u05DA \u05D4\u05E1\u05EA\u05D9\u05D9\u05DD \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4!');
    } catch (err) {
      const msg = err.message || '\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E2\u05D9\u05D1\u05D5\u05D3 \u05D4\u05DE\u05E1\u05DE\u05DA.';
      setImprovementStep(msg);
      setImprovementLogs(prev => [...prev, msg]);
      setIsImproving(false);
    }
  };

  // ===================== MARKET RESEARCH =====================
  const handleStartMarketResearch = async () => {
    const goal = (marketResearchGoal || projectGoal || '').trim();
    if (!editorContent) { alert('\u05D0\u05E0\u05D0 \u05E2\u05D1\u05D3\u05D5 \u05E7\u05D5\u05D1\u05E5 \u05EA\u05D7\u05D9\u05DC\u05D4.'); return; }
    if (!goal) { alert('\u05D0\u05E0\u05D0 \u05EA\u05D0\u05E8\u05D5 \u05D0\u05EA \u05D4\u05DE\u05D8\u05E8\u05D4.'); return; }
    setIsMarketResearchLoading(true); setMarketResearchError(''); setMarketResearchMarkdown('');
    setTocRecommendations(''); setRecsError('');
    setMarketResearchWorkflowId('');
    startLoadingMessages([
      '\u05D0\u05D5\u05E1\u05E3 \u05DE\u05D9\u05D3\u05E2 \u05E2\u05DC \u05D4\u05EA\u05D7\u05D5\u05DD...',
      '\u05DE\u05E0\u05EA\u05D7 \u05DE\u05D2\u05DE\u05D5\u05EA \u05D1\u05E9\u05D5\u05E7...',
      '\u05DE\u05D6\u05D4\u05D4 \u05DE\u05EA\u05D7\u05E8\u05D9\u05DD \u05D5\u05E1\u05E4\u05E7\u05D9\u05DD...',
      '\u05DE\u05E8\u05DB\u05D6 \u05EA\u05D5\u05D1\u05E0\u05D5\u05EA \u05D5\u05DE\u05DE\u05E6\u05D0\u05D9\u05DD...',
      '\u05DE\u05E1\u05DB\u05DD \u05D0\u05EA \u05EA\u05D5\u05E6\u05D0\u05D5\u05EA \u05D4\u05DE\u05D7\u05E7\u05E8...',
    ]);
    try {
      const workflow = await runWorkflowToCompletion('/api/market-research', { summary: editorContent, user_goal: goal }, syncMarketResearchWorkflowState);
      if (workflow.status === 'failed') throw new Error(workflow.last_error || 'Failed');
    } catch (e) {
      setMarketResearchError(e.message || '\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D1\u05D9\u05E6\u05D5\u05E2 \u05DE\u05D7\u05E7\u05E8 \u05E9\u05D5\u05E7');
    } finally { setIsMarketResearchLoading(false); stopLoadingMessages(); }
  };

  // ===================== TOC RECOMMENDATIONS =====================
  const handleFetchRecommendations = async () => {
    if (!editorContent || !marketResearchMarkdown || isRecsLoading) return;
    setIsRecsLoading(true); setRecsError(''); setTocRecommendations('');
    startLoadingMessages([
      '\u05DE\u05E0\u05EA\u05D7 \u05D0\u05EA \u05DE\u05D1\u05E0\u05D4 \u05D4\u05DE\u05E1\u05DE\u05DA...',
      '\u05DE\u05E9\u05D5\u05D5\u05D4 \u05DC\u05DE\u05D7\u05E7\u05E8 \u05D4\u05E9\u05D5\u05E7...',
      '\u05DE\u05D2\u05D1\u05E9 \u05D4\u05DE\u05DC\u05E6\u05D5\u05EA \u05DC\u05E9\u05D9\u05E4\u05D5\u05E8...',
    ]);
    try {
      const res = await fetch('/api/toc-recommendations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: editorContent, market_research: marketResearchMarkdown, original_toc: originalTocItems })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setTocRecommendations(data.recommendations || '');
    } catch (e) { setRecsError(e.message); } finally { setIsRecsLoading(false); stopLoadingMessages(); }
  };

  const handleRecsChatSend = async () => {
    const trimmed = recsChatInput.trim();
    if (!trimmed || isRecsChatLoading) return;
    setRecsChatInput('');
    const userMsg = { role: 'user', content: trimmed };
    const updated = [...recsChatMessages, userMsg];
    setRecsChatMessages(updated);
    setIsRecsChatLoading(true);
    const history = recsChatMessages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.content }));
    try {
      const res = await fetch('/api/toc-recommendations-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed, current_recommendations: tocRecommendations,
          original_toc: originalTocItems, document_summary: editorContent,
          market_research: marketResearchMarkdown, chat_history: history
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.updated_recommendations) {
        setTocRecommendations(data.updated_recommendations);
        setRecsJustUpdated(true);
        setTimeout(() => setRecsJustUpdated(false), 2500);
      }
      setRecsChatMessages([...updated, { role: 'assistant', content: data.message, hasUpdate: !!data.updated_recommendations }]);
    } catch (e) {
      setRecsChatMessages([...updated, { role: 'assistant', content: '\u05E9\u05D2\u05D9\u05D0\u05D4: ' + e.message }]);
    } finally { setIsRecsChatLoading(false); }
  };

  // ===================== TOC GENERATION =====================
  const getOriginalTocTextFromSummaries = () => {
    const tocRow = (improvementTable || []).find(row => {
      const title = (row?.section_title || '').toLowerCase();
      return title.includes('\u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD') || title.includes('table of contents');
    });
    return (tocRow?.original_text || '').trim();
  };

  const handleCreateNewTableOfContents = async () => {
    if (!editorContent || !marketResearchMarkdown || isTocLoading) return;
    setIsTocLoading(true); setTocError(''); setTocModificationRow(null);
    setTocSectionRows([]); setSectionWorkflowId(''); setCurrentSectionIndex(-1);
    setTocChatMessages([]);
    startLoadingMessages([
      '\u05DE\u05E0\u05EA\u05D7 \u05D0\u05EA \u05DE\u05D1\u05E0\u05D4 \u05D4\u05DE\u05E1\u05DE\u05DA \u05D4\u05DE\u05E7\u05D5\u05E8\u05D9...',
      '\u05DE\u05E9\u05DC\u05D1 \u05EA\u05D5\u05D1\u05E0\u05D5\u05EA \u05DE\u05DE\u05D7\u05E7\u05E8 \u05D4\u05E9\u05D5\u05E7...',
      '\u05D1\u05D5\u05E0\u05D4 \u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05D7\u05D3\u05E9...',
      '\u05DE\u05E9\u05D5\u05D5\u05D4 \u05D1\u05D9\u05DF \u05DE\u05E7\u05D5\u05E8\u05D9 \u05DC\u05D7\u05D3\u05E9...',
    ]);
    try {
      const originalTocFromSummary = getOriginalTocTextFromSummaries();
      const res = await fetch('/api/table-of-contents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: editorContent, market_research: marketResearchMarkdown,
          original_toc_text: originalTocFromSummary, original_toc: originalTocItems
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      const exactOriginalText = originalTocFromSummary || data.original_toc_page_text || data.original_toc_text || '';
      const baselineOriginalText = tocOriginalBaselineText || exactOriginalText;
      if (!tocOriginalBaselineText && exactOriginalText) setTocOriginalBaselineText(exactOriginalText);
      setTocOriginalToc(data.original_toc || []);
      setTocNewToc(data.new_toc || []);
      setTocModificationRow({
        sectionTitle: '\u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD',
        originalText: baselineOriginalText,
        improvedText: data.new_toc_text || '',
        explanation: data.additions_explanation || ''
      });
      const originalSet = new Set((data.original_toc || []).map(s => `${s.kind}|${s.number}|${s.title}`));
      const sectionRows = (data.new_toc || []).map(section => {
        const isExisting = originalSet.has(`${section.kind}|${section.number}|${section.title}`);
        const sectionLabel = [section.kind, section.number, section.title].filter(Boolean).join(' ');
        let originalText = '';
        if (isExisting) {
          const matchingRow = (improvementTable || []).find(row => {
            const rowTitle = (row.section_title || '').trim();
            return rowTitle.includes(section.title) || (section.title && section.title.includes(rowTitle));
          });
          originalText = matchingRow ? (matchingRow.original_text || matchingRow.summary || '') : '';
        }
        return { sectionTitle: sectionLabel, originalText, improvedText: '', explanation: '' };
      });
      setTocSectionRows(sectionRows);
      setCurrentSectionIndex(0);
      setTocPanelJustUpdated(true);
      setTimeout(() => setTocPanelJustUpdated(false), 2500);
    } catch (e) {
      setTocError(e.message || '\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D9\u05E6\u05D9\u05E8\u05EA \u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD');
    } finally { setIsTocLoading(false); stopLoadingMessages(); }
  };

  // ===================== TOC CHAT =====================
  const handleTocChatSend = async () => {
    const trimmed = tocChatInput.trim();
    if (!trimmed || isTocChatLoading || !tocNewToc.length) return;
    setTocChatInput('');
    const userMsg = { role: 'user', content: trimmed };
    const updated = [...tocChatMessages, userMsg];
    setTocChatMessages(updated);
    setIsTocChatLoading(true);
    const history = tocChatMessages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.content }));
    try {
      const res = await fetch('/api/toc-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed, current_toc: tocNewToc, original_toc: tocOriginalToc,
          document_summary: editorContent, market_research: marketResearchMarkdown,
          chat_history: history
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const assistantMsg = {
        role: 'assistant', content: data.message,
        isProposal: data.is_proposal, proposedToc: data.proposed_toc,
        changesExplanation: data.changes_explanation
      };
      setTocChatMessages([...updated, assistantMsg]);
    } catch (e) {
      setTocChatMessages([...updated, { role: 'assistant', content: '\u05E9\u05D2\u05D9\u05D0\u05D4: ' + e.message }]);
    } finally { setIsTocChatLoading(false); }
  };

  const handleAcceptTocProposal = (proposedToc, msgIndex) => {
    if (!proposedToc || !Array.isArray(proposedToc)) return;
    setTocNewToc(proposedToc);
    const newTocText = proposedToc.map(t => [t.kind, t.number, t.title].filter(Boolean).join(' ')).join('\n');
    setTocModificationRow(prev => prev ? { ...prev, improvedText: newTocText } : prev);
    const originalSet = new Set((tocOriginalToc || []).map(s => `${s.kind}|${s.number}|${s.title}`));
    const sectionRows = proposedToc.map(section => {
      const isExisting = originalSet.has(`${section.kind}|${section.number}|${section.title}`);
      const sectionLabel = [section.kind, section.number, section.title].filter(Boolean).join(' ');
      let originalText = '';
      if (isExisting) {
        const matchingRow = (improvementTable || []).find(row => {
          const rowTitle = (row.section_title || '').trim();
          return rowTitle.includes(section.title) || (section.title && section.title.includes(rowTitle));
        });
        originalText = matchingRow ? (matchingRow.original_text || matchingRow.summary || '') : '';
      }
      const existingRow = tocSectionRows.find(r => r.sectionTitle === sectionLabel);
      return {
        sectionTitle: sectionLabel, originalText,
        improvedText: existingRow?.improvedText || '',
        explanation: existingRow?.explanation || ''
      };
    });
    setTocSectionRows(sectionRows);
    setCurrentSectionIndex(sectionRows.findIndex(r => !r.improvedText));
    setTocChatMessages(msgs => msgs.map((m, i) => i === msgIndex ? { ...m, accepted: true } : m));
    setTocPanelJustUpdated(true);
    setTimeout(() => setTocPanelJustUpdated(false), 2500);
  };

  const handleDeclineTocProposal = (msgIndex) => {
    setTocChatMessages(msgs => msgs.map((m, i) => i === msgIndex ? { ...m, declined: true } : m));
  };

  // ===================== SECTION GENERATION =====================
  const handleCreateNextSection = async () => {
    if (currentSectionIndex < 0 || currentSectionIndex >= tocSectionRows.length || isSectionLoading) return;
    setIsSectionLoading(true); setSectionError('');
    const sectionName = tocSectionRows[currentSectionIndex]?.sectionTitle || '';
    startLoadingMessages([
      `\u05DE\u05E0\u05EA\u05D7 \u05D0\u05EA \u05D4\u05E1\u05E2\u05D9\u05E3: ${sectionName}`,
      '\u05DE\u05E9\u05D5\u05D5\u05D4 \u05DC\u05DE\u05E1\u05DE\u05DA \u05D4\u05DE\u05E7\u05D5\u05E8\u05D9...',
      '\u05DE\u05E9\u05DC\u05D1 \u05EA\u05D5\u05D1\u05E0\u05D5\u05EA \u05DE\u05DE\u05D7\u05E7\u05E8 \u05D4\u05E9\u05D5\u05E7...',
      '\u05DB\u05D5\u05EA\u05D1 \u05D0\u05EA \u05D4\u05E1\u05E2\u05D9\u05E3 \u05D4\u05DE\u05E9\u05D5\u05E4\u05E8...',
    ]);
    try {
      let wfId = sectionWorkflowId;
      if (!wfId) {
        const created = await fetchWorkflowJson('/api/section-generation', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sections: tocSectionRows, market_research: marketResearchMarkdown,
            document_summary: editorContent,
          })
        });
        wfId = created.workflow_id;
        syncSectionWorkflowState(created);
      }
      const workflow = await advanceWorkflow(wfId);
      syncSectionWorkflowState(workflow);
      if (workflow.status === 'failed') throw new Error(workflow.last_error || 'Failed');
    } catch (e) {
      setSectionError(e.message || '\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D9\u05E6\u05D9\u05E8\u05EA \u05E1\u05E2\u05D9\u05E3');
    } finally { setIsSectionLoading(false); stopLoadingMessages(); }
  };

  // ===================== SECTION CHAT =====================
  const handleRowClick = (index) => {
    if (selectedRowIndex !== index) {
      setSelectedRowIndex(index);
      setChatMessages([]);
      if (isChatCollapsed) setIsChatCollapsed(false);
    }
  };

  const handleChatSend = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || selectedRowIndex < 0 || isChatLoading) return;
    setChatInput('');
    const userMsg = { role: 'user', content: trimmed };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated);
    setIsChatLoading(true);
    const history = chatMessages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.content }));
    try {
      const tocRow = tocSectionRows[selectedRowIndex];
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          selected_row: {
            section_title: tocRow.sectionTitle, original_text: tocRow.originalText,
            improved_text: tocRow.improvedText, explanation: tocRow.explanation,
          },
          chat_history: history
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChatMessages([...updated, {
        role: 'assistant', content: data.message,
        isProposal: data.is_proposal, proposedText: data.proposed_improved_text
      }]);
    } catch (e) {
      setChatMessages([...updated, { role: 'assistant', content: '\u05E9\u05D2\u05D9\u05D0\u05D4: ' + e.message }]);
    } finally { setIsChatLoading(false); }
  };

  const handleAcceptProposal = (proposedText, msgIndex) => {
    setTocSectionRows(prev => prev.map((row, i) => i === selectedRowIndex ? { ...row, improvedText: proposedText } : row));
    setChatMessages(msgs => msgs.map((m, i) => i === msgIndex ? { ...m, accepted: true } : m));
    setFlashRowIndex(selectedRowIndex);
    setTimeout(() => setFlashRowIndex(-1), 2000);
  };

  const handleDeclineProposal = (msgIndex) => {
    setChatMessages(msgs => msgs.map((m, i) => i === msgIndex ? { ...m, declined: true } : m));
  };

  // ===================== SAVE =====================
  const buildImprovedDocumentMarkdown = () => {
    const parts = [];
    if (tocModificationRow && tocModificationRow.improvedText) {
      parts.push(`## ${tocModificationRow.sectionTitle}\n\n${tocModificationRow.improvedText}`);
    }
    tocSectionRows.forEach(row => {
      if (row.improvedText) parts.push(`## ${row.sectionTitle}\n\n${row.improvedText}`);
    });
    return parts.join('\n\n');
  };

  const handleSaveVersion = async () => {
    const saveName = (draftName || newVersionName || '').trim();
    const improvedMd = buildImprovedDocumentMarkdown();
    if (!saveName || (improvementTable.length === 0 && !improvedMd)) {
      alert('\u05D0\u05E0\u05D0 \u05E2\u05D1\u05D3\u05D5 \u05E7\u05D5\u05D1\u05E5 \u05EA\u05D7\u05D9\u05DC\u05D4.'); return;
    }
    const filename = buildOutputFilename(saveName, outputFormat);
    const mdContent = improvedMd || improvementTable.map(r => `## ${r.section_title}\n\n${r.summary}`).join('\n\n');
    try {
      const res = await fetch('/api/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: mdContent, output_format: outputFormat })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      fetchCreatedFiles();
      alert(`\u05D4\u05DE\u05E1\u05DE\u05DA \u05E0\u05E9\u05DE\u05E8 \u05D1\u05E9\u05DD ${data.filename || filename}!`);
    } catch (e) { alert(e.message || '\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E9\u05DE\u05D9\u05E8\u05D4'); }
  };

  const handleDownloadFile = (filename) => {
    window.open(`/api/files/${encodeURIComponent(filename)}`, '_blank');
  };

  // ===================== WIZARD LOGIC =====================
  const isSectionNew = (sectionTitle) => {
    if (!originalTocItems || originalTocItems.length === 0) return false;
    return !originalTocItems.some(orig => {
      const origLabel = [orig.kind, orig.number, orig.title].filter(Boolean).join(' ');
      return origLabel === sectionTitle || (orig.title && sectionTitle.includes(orig.title));
    });
  };

  const stepCompleted = (idx) => {
    switch (idx) {
      case 0: return uploadedFiles.length > 0 && selectedFile !== '';
      case 1: return improvementTable.length > 0 && !isImproving;
      case 2: return !!marketResearchMarkdown;
      case 3: return tocSectionRows.length > 0;
      case 4: return tocSectionRows.length > 0 && tocSectionRows.some(r => r.improvedText);
      case 5: return false;
      default: return false;
    }
  };

  const canGoToStep = (idx) => {
    if (idx === 0) return true;
    return stepCompleted(idx - 1);
  };

  const handleStepClick = (idx) => {
    if (canGoToStep(idx)) setWizardStep(idx);
  };

  // ===================== WORD DIFF HELPER =====================
  const renderWordDiff = (oldText, newText) => {
    if (!oldText || !newText || typeof Diff === 'undefined') return null;
    const changes = Diff.diffWords(oldText, newText);
    return React.createElement('span', null, changes.map((part, i) => {
      if (part.added) return React.createElement('ins', { key: i, className: 'diff-added' }, part.value);
      if (part.removed) return React.createElement('del', { key: i, className: 'diff-removed' }, part.value);
      return React.createElement('span', { key: i }, part.value);
    }));
  };

  // ===================== TOC DIFF VIEW =====================
  const renderTocDiffView = () => {
    if (!tocModificationRow) return null;
    const originalLines = (tocModificationRow.originalText || '').split('\n').filter(l => l.trim());
    const newLines = (tocModificationRow.improvedText || '').split('\n').filter(l => l.trim());
    const originalSet = new Set(originalLines.map(l => l.trim()));

    return React.createElement('div', null,
      React.createElement('div', { className: 'toc-diff-container' },
        React.createElement('div', { className: 'toc-diff-panel' },
          React.createElement('h5', null, '\u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05DE\u05E7\u05D5\u05E8\u05D9'),
          originalLines.map((line, i) => {
            return React.createElement('div', {
              key: `orig-${i}`,
              className: 'toc-diff-line unchanged'
            }, line.trim());
          })
        ),
        React.createElement('div', {
          className: `toc-diff-panel ${tocPanelJustUpdated ? 'toc-panel-just-updated' : ''}`
        },
          React.createElement('h5', null, '\u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05D7\u05D3\u05E9'),
          newLines.map((line, i) => {
            const inOriginal = originalSet.has(line.trim());
            const isNew = !inOriginal;
            return React.createElement('div', {
              key: `new-${i}`,
              className: `toc-diff-line ${isNew ? 'added' : 'unchanged'}`
            },
              line.trim(),
              isNew && React.createElement('span', {
                style: { marginRight: '8px', padding: '1px 8px', fontSize: '0.7rem', borderRadius: '10px', backgroundColor: '#dbeafe', color: '#1d4ed8', fontWeight: '600' }
              }, '\u05D7\u05D3\u05E9')
            );
          })
        )
      ),
      React.createElement('div', { className: 'toc-diff-legend' },
        React.createElement('div', { className: 'toc-diff-legend-item' },
          React.createElement('div', { className: 'toc-diff-legend-dot added' }),
          React.createElement('span', null, '\u05EA\u05D5\u05E1\u05E4\u05EA \u05D7\u05D3\u05E9\u05D4')
        ),
        React.createElement('div', { className: 'toc-diff-legend-item' },
          React.createElement('div', { className: 'toc-diff-legend-dot removed' }),
          React.createElement('span', null, '\u05D4\u05D5\u05E1\u05E8')
        ),
        React.createElement('div', { className: 'toc-diff-legend-item' },
          React.createElement('div', { className: 'toc-diff-legend-dot unchanged' }),
          React.createElement('span', null, '\u05DC\u05DC\u05D0 \u05E9\u05D9\u05E0\u05D5\u05D9')
        )
      ),
      tocModificationRow.explanation && React.createElement('div', {
        style: { marginTop: '12px', padding: '12px 16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', direction: 'rtl', fontSize: '0.9rem', color: '#166534', lineHeight: '1.6' }
      }, tocModificationRow.explanation)
    );
  };

  // ===================== IMPROVED DOCUMENT PREVIEW =====================
  const renderImprovedDocumentPreview = () => {
    const hasToc = tocModificationRow && tocModificationRow.improvedText;
    const hasContent = tocSectionRows.some(r => r.improvedText);
    if (!hasToc && !hasContent) return null;
    const tocLines = hasToc ? tocModificationRow.improvedText.split('\n').filter(l => l.trim()) : [];

    return React.createElement('div', { dir: 'rtl', style: { border: '1px solid #cbd5e1', borderRadius: '8px', padding: '20px', backgroundColor: '#fff', lineHeight: '1.7', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' } },
      hasToc && React.createElement('div', { style: { marginBottom: '24px' } },
        React.createElement('h2', { style: { fontSize: '1.1rem', color: '#0f172a', borderBottom: '2px solid #0f766e', paddingBottom: '6px', marginBottom: '12px' } }, tocModificationRow.sectionTitle),
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', direction: 'rtl', textAlign: 'right' } },
          React.createElement('tbody', null,
            tocLines.map((line, i) => {
              const isNew = isSectionNew(line.trim());
              return React.createElement('tr', { key: `toc-line-${i}` },
                React.createElement('td', {
                  style: {
                    padding: '6px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem',
                    color: isNew ? '#2563eb' : '#0f172a', fontWeight: isNew ? '600' : '400',
                    backgroundColor: isNew ? '#eff6ff' : 'transparent'
                  }
                },
                  line.trim(),
                  isNew && React.createElement('span', {
                    style: { display: 'inline-block', marginRight: '8px', padding: '1px 8px', fontSize: '0.7rem', borderRadius: '10px', backgroundColor: '#dbeafe', color: '#1d4ed8', fontWeight: '600', verticalAlign: 'middle' }
                  }, '\u05D7\u05D3\u05E9')
                )
              );
            })
          )
        )
      ),
      tocSectionRows.map((row, i) => {
        if (!row.improvedText) return null;
        const isNew = isSectionNew(row.sectionTitle);
        return React.createElement('div', { key: `preview-${i}`, style: { marginBottom: '20px' } },
          React.createElement('h3', {
            style: { fontSize: '1rem', marginBottom: '8px', paddingBottom: '4px', borderBottom: isNew ? '2px solid #3b82f6' : '1px solid #e2e8f0', color: isNew ? '#2563eb' : '#0f172a' }
          },
            row.sectionTitle,
            isNew && React.createElement('span', {
              style: { display: 'inline-block', marginRight: '8px', padding: '2px 10px', fontSize: '0.72rem', borderRadius: '10px', backgroundColor: '#dbeafe', color: '#1d4ed8', fontWeight: '600', verticalAlign: 'middle' }
            }, '\u05EA\u05D5\u05E1\u05E4\u05EA \u05D7\u05D3\u05E9\u05D4')
          ),
          React.createElement('div', {
            className: 'rendered-md',
            dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(row.improvedText)) },
            style: { fontSize: '0.9rem', color: '#334155' }
          })
        );
      })
    );
  };

  // ===================== RENDER: WIZARD PROGRESS BAR =====================
  const renderWizardProgress = () => {
    return React.createElement('div', { className: 'wizard-progress' },
      WIZARD_STEPS.map((step, i) => {
        const completed = stepCompleted(i);
        const active = wizardStep === i;
        const disabled = !canGoToStep(i);
        let cls = 'wizard-step-item';
        if (active) cls += ' active';
        else if (completed) cls += ' completed';
        else if (disabled) cls += ' disabled';

        return React.createElement(React.Fragment, { key: step.key },
          i > 0 && React.createElement('div', { className: `wizard-line ${stepCompleted(i - 1) ? 'completed' : ''}` }),
          React.createElement('div', { className: cls, onClick: () => handleStepClick(i) },
            React.createElement('div', { className: 'wizard-dot' },
              completed && !active ? '\u2713' : (i + 1)
            ),
            React.createElement('div', { className: 'wizard-label' }, step.labelHe)
          )
        );
      })
    );
  };

  // ===================== RENDER: CHAT PANEL =====================
  const renderChatPanel = () => {
    const inTocStep = wizardStep === 3;
    const inSectionsStep = wizardStep === 4;
    const chatEnabled = (inSectionsStep && tocSectionRows.length > 0) || (inTocStep && tocNewToc.length > 0);
    const selectedRow = inSectionsStep && selectedRowIndex >= 0 ? tocSectionRows[selectedRowIndex] : null;

    const activeChatMessages = inTocStep ? tocChatMessages : chatMessages;
    const activeChatInput = inTocStep ? tocChatInput : chatInput;
    const setActiveChatInput = inTocStep ? setTocChatInput : setChatInput;
    const handleActiveSend = inTocStep ? handleTocChatSend : handleChatSend;
    const isActiveLoading = inTocStep ? isTocChatLoading : isChatLoading;
    const inputEnabled = chatEnabled && (inTocStep || selectedRowIndex >= 0) && !isActiveLoading;

    return React.createElement('div', {
      className: `left-panel ${isChatCollapsed ? 'collapsed' : ''}`,
      style: { transition: 'width 0.3s', width: isChatCollapsed ? '50px' : '380px', position: 'relative', overflow: 'hidden' }
    },
      React.createElement('button', {
        onClick: () => setIsChatCollapsed(!isChatCollapsed),
        style: { position: 'absolute', top: '10px', left: '10px', zIndex: 10, border: '1px solid #cbd5e1', borderRadius: '4px', background: '#fff', cursor: 'pointer', padding: '5px 8px', fontSize: '0.85rem' }
      }, isChatCollapsed ? '<<' : '>>'),

      !isChatCollapsed && React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        React.createElement('h2', { style: { paddingRight: '40px', marginBottom: '8px' } },
          inTocStep ? '\u05E9\u05D9\u05D7\u05EA \u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD' : '\u05E9\u05D9\u05D7\u05EA \u05E2\u05D5\u05D6\u05E8'
        ),

        selectedRow && React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', margin: '0 0 8px 0', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '20px', fontSize: '0.82rem', color: '#1d4ed8', fontWeight: '600' },
          dir: 'rtl'
        },
          React.createElement('span', null, '\u00A7'),
          React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selectedRow.sectionTitle)
        ),

        React.createElement('div', { className: 'chat-messages', style: { display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', gap: '8px', padding: '4px 0' } },
          isImproving ? (
            React.createElement('div', { style: { padding: '20px', backgroundColor: '#f1f5f9', borderRadius: '8px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' } },
              React.createElement('div', { style: { width: '30px', height: '30px', borderRadius: '50%', border: '3px solid #cbd5e1', borderTopColor: '#3b82f6', animation: 'spin 1s linear infinite' } }),
              React.createElement('p', { style: { margin: 0, textAlign: 'center', color: '#0f172a', fontWeight: 'bold' }, dir: 'rtl' }, improvementStep),
              React.createElement('div', { style: { width: '100%', maxHeight: '260px', overflowY: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px' }, dir: 'rtl' },
                improvementLogs.map((log, i) => React.createElement('div', { key: i, style: { fontSize: '0.82rem', color: '#334155', padding: '6px 0', borderBottom: i === improvementLogs.length - 1 ? 'none' : '1px solid #e2e8f0' } }, log))
              )
            )
          ) : !chatEnabled ? (
            React.createElement('p', { className: 'system-message', dir: 'rtl' },
              inTocStep ? '\u05E6\u05E8\u05D5 \u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05D7\u05D3\u05E9 \u05DB\u05D3\u05D9 \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05DC\u05E9\u05D5\u05D7\u05D7 \u05E2\u05DC\u05D9\u05D5.'
                : inSectionsStep ? '\u05DC\u05D7\u05E6\u05D5 \u05E2\u05DC \u05E1\u05E2\u05D9\u05E3 \u05D1\u05D8\u05D1\u05DC\u05D4 \u05DB\u05D3\u05D9 \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05DC\u05E9\u05D5\u05D7\u05D7.'
                : '\u05E9\u05DC\u05D5\u05DD! \u05D0\u05E0\u05D9 \u05D4\u05E2\u05D5\u05D6\u05E8 \u05E9\u05DC\u05DB\u05DD. \u05D4\u05E9\u05EA\u05DE\u05E9\u05D5 \u05D1\u05E9\u05DC\u05D1\u05D9 \u05D4\u05D0\u05E9\u05E3 \u05DB\u05D3\u05D9 \u05DC\u05D1\u05E0\u05D5\u05EA \u05D0\u05EA \u05D4\u05DE\u05E1\u05DE\u05DA.'
            )
          ) : activeChatMessages.length === 0 ? (
            React.createElement('p', { className: 'system-message', style: { color: '#64748b', fontSize: '0.9rem' }, dir: 'rtl' },
              inTocStep ? '\u05E0\u05D9\u05EA\u05DF \u05DC\u05E9\u05E0\u05D5\u05EA \u05D0\u05EA \u05EA\u05D5\u05DB\u05DF \u05D4\u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05D3\u05E8\u05DA \u05D4\u05E9\u05D9\u05D7\u05D4. \u05E9\u05D0\u05DC\u05D5 \u05E9\u05D0\u05DC\u05D4 \u05D0\u05D5 \u05D1\u05E7\u05E9\u05D5 \u05E9\u05D9\u05E0\u05D5\u05D9.'
                : selectedRow ? `\u05D0\u05E0\u05D9 \u05DE\u05D5\u05DB\u05DF \u05DC\u05E2\u05D6\u05D5\u05E8 \u05E2\u05DD ${selectedRow.sectionTitle}. \u05DE\u05D4 \u05EA\u05E8\u05E6\u05D5 \u05DC\u05E9\u05E0\u05D5\u05EA?`
                : '\u05DC\u05D7\u05E6\u05D5 \u05E2\u05DC \u05E9\u05D5\u05E8\u05D4 \u05D1\u05D8\u05D1\u05DC\u05EA \u05D4\u05E1\u05E2\u05D9\u05E4\u05D9\u05DD \u05DB\u05D3\u05D9 \u05DC\u05D1\u05D7\u05D5\u05E8 \u05E1\u05E2\u05D9\u05E3 \u05D5\u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05DC\u05E9\u05D5\u05D7\u05D7.'
            )
          ) : (
            activeChatMessages.map((msg, i) => React.createElement('div', {
              key: i, style: { alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%' }
            },
              React.createElement('div', {
                style: {
                  padding: '16px 24px', borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  backgroundColor: msg.role === 'user' ? '#3b82f6' : '#f1f5f9',
                  color: msg.role === 'user' ? '#fff' : '#0f172a', fontSize: '0.88rem', lineHeight: '1.5', whiteSpace: 'pre-wrap'
                }, dir: 'rtl'
              }, msg.content),

              msg.isProposal && msg.proposedText && React.createElement('div', {
                style: { marginTop: '8px', padding: '10px 12px', border: '1px solid #bfdbfe', borderRadius: '8px', backgroundColor: '#fff', fontSize: '0.85rem', opacity: (msg.accepted || msg.declined) ? 0.6 : 1 }, dir: 'rtl'
              },
                React.createElement('div', { style: { fontWeight: '600', marginBottom: '6px', color: '#1d4ed8' } }, '\u05D8\u05E7\u05E1\u05D8 \u05DE\u05E9\u05D5\u05E4\u05E8 \u05DE\u05D5\u05E6\u05E2:'),
                React.createElement('div', { style: { whiteSpace: 'pre-wrap', color: '#0f172a', marginBottom: '10px' } }, msg.proposedText),
                !msg.accepted && !msg.declined ? React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                  React.createElement('button', { onClick: () => handleAcceptProposal(msg.proposedText, i), style: { flex: 1, padding: '6px 0', backgroundColor: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' } }, '\u05D0\u05D9\u05E9\u05D5\u05E8'),
                  React.createElement('button', { onClick: () => handleDeclineProposal(i), style: { flex: 1, padding: '6px 0', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' } }, '\u05D3\u05D7\u05D9\u05D9\u05D4')
                ) : React.createElement('div', { style: { fontSize: '0.8rem', color: msg.accepted ? '#16a34a' : '#dc2626', fontWeight: '600' } }, msg.accepted ? '\u2713 \u05D0\u05D5\u05E9\u05E8' : '\u2717 \u05E0\u05D3\u05D7\u05D4')
              ),

              msg.isProposal && msg.proposedToc && React.createElement('div', {
                style: { marginTop: '8px', padding: '10px 12px', border: '1px solid #bfdbfe', borderRadius: '8px', backgroundColor: '#fff', fontSize: '0.85rem', opacity: (msg.accepted || msg.declined) ? 0.6 : 1 }, dir: 'rtl'
              },
                React.createElement('div', { style: { fontWeight: '600', marginBottom: '6px', color: '#1d4ed8' } }, '\u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05DE\u05D5\u05E6\u05E2:'),
                React.createElement('div', { style: { whiteSpace: 'pre-wrap', color: '#0f172a', marginBottom: '6px', fontSize: '0.82rem' } },
                  msg.proposedToc.map(t => [t.kind, t.number, t.title].filter(Boolean).join(' ')).join('\n')
                ),
                msg.changesExplanation && React.createElement('div', { style: { fontSize: '0.8rem', color: '#475569', marginBottom: '10px', fontStyle: 'italic' } }, msg.changesExplanation),
                !msg.accepted && !msg.declined ? React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                  React.createElement('button', { onClick: () => handleAcceptTocProposal(msg.proposedToc, i), style: { flex: 1, padding: '6px 0', backgroundColor: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' } }, '\u05D0\u05D9\u05E9\u05D5\u05E8'),
                  React.createElement('button', { onClick: () => handleDeclineTocProposal(i), style: { flex: 1, padding: '6px 0', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' } }, '\u05D3\u05D7\u05D9\u05D9\u05D4')
                ) : React.createElement('div', { style: { fontSize: '0.8rem', color: msg.accepted ? '#16a34a' : '#dc2626', fontWeight: '600' } }, msg.accepted ? '\u2713 \u05D0\u05D5\u05E9\u05E8' : '\u2717 \u05E0\u05D3\u05D7\u05D4')
              ),

              msg.hasUpdate && React.createElement('div', { style: { marginTop: '4px', fontSize: '0.78rem', color: '#0f766e', fontWeight: '600' } }, '\u2713 \u05D4\u05D4\u05DE\u05DC\u05E6\u05D5\u05EA \u05E2\u05D5\u05D3\u05DB\u05E0\u05D5')
            ))
          ),

          isActiveLoading && React.createElement('div', { style: { alignSelf: 'flex-start', padding: '16px 24px', backgroundColor: '#f1f5f9', borderRadius: '12px', fontSize: '0.85rem', color: '#64748b' } }, '\u05D7\u05D5\u05E9\u05D1...'),
          React.createElement('div', { ref: chatEndRef })
        ),

        React.createElement('div', { className: 'chat-input-wrapper' },
          React.createElement('input', {
            type: 'text',
            placeholder: !chatEnabled ? '\u05DC\u05D0 \u05D6\u05DE\u05D9\u05DF \u05D1\u05E9\u05DC\u05D1 \u05D6\u05D4...' : inTocStep ? '\u05E9\u05D0\u05DC\u05D5 \u05E2\u05DC \u05EA\u05D5\u05DB\u05DF \u05D4\u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD...' : selectedRowIndex < 0 ? '\u05D1\u05D7\u05E8\u05D5 \u05E1\u05E2\u05D9\u05E3...' : '\u05D4\u05E7\u05DC\u05D9\u05D3\u05D5 \u05D4\u05D5\u05D3\u05E2\u05D4...',
            className: 'chat-input',
            value: activeChatInput,
            onChange: e => setActiveChatInput(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter') handleActiveSend(); },
            disabled: !inputEnabled,
            style: { opacity: inputEnabled ? 1 : 0.5 }
          }),
          React.createElement('button', { onClick: handleActiveSend, disabled: !inputEnabled, style: { opacity: inputEnabled ? 1 : 0.5 } }, '\u05E9\u05DC\u05D7')
        )
      )
    );
  };

  // ===================== RENDER: WIZARD STEP CONTENT =====================
  const renderStepContent = () => {
    switch (wizardStep) {
      // ---- STEP 0: UPLOAD ----
      case 0:
        return React.createElement('div', { className: 'wizard-content-area', dir: 'rtl' },
          // -- Project Goal Card --
          React.createElement('div', { className: 'upload-section-card' },
            React.createElement('h3', null, '\u05DE\u05D8\u05E8\u05EA \u05D4\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8'),
            React.createElement('p', { className: 'section-desc' },
              '\u05EA\u05D0\u05E8\u05D5 \u05D0\u05EA \u05DE\u05D8\u05E8\u05EA \u05D4\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8 \u05D5\u05D4\u05D9\u05E2\u05D3\u05D9\u05DD \u05E9\u05DC\u05DB\u05DD. \u05D6\u05D4 \u05D9\u05E0\u05D7\u05D4 \u05D0\u05EA \u05EA\u05D4\u05DC\u05D9\u05DA \u05DE\u05D7\u05E7\u05E8 \u05D4\u05E9\u05D5\u05E7 \u05D5\u05E9\u05D9\u05E4\u05D5\u05E8 \u05D4\u05DE\u05E1\u05DE\u05DA.'
            ),
            React.createElement('textarea', {
              dir: 'rtl',
              value: projectGoal,
              onChange: e => { setProjectGoal(e.target.value); if (!marketResearchGoal) setMarketResearchGoal(e.target.value); },
              placeholder: '\u05EA\u05D0\u05E8\u05D5 \u05D0\u05EA \u05DE\u05D8\u05E8\u05EA \u05D4\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8 \u05D5\u05D4\u05D9\u05E2\u05D3\u05D9\u05DD \u05E9\u05DC\u05DB\u05DD...',
              style: { width: '100%', minHeight: '100px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px', fontSize: '0.95rem', lineHeight: '1.5', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }
            })
          ),
          // -- Existing Files + Select Card --
          React.createElement('div', { className: 'upload-section-card' },
            React.createElement('h3', null, '\u05E7\u05D1\u05E6\u05D9\u05DD \u05E9\u05D4\u05D5\u05E2\u05DC\u05D5'),
            uploadedFiles.length === 0
              ? React.createElement('div', { className: 'empty-state' }, '\u05D8\u05E8\u05DD \u05D4\u05D5\u05E2\u05DC\u05D5 \u05E7\u05D1\u05E6\u05D9\u05DD.')
              : React.createElement('div', null,
                  uploadedFiles.map(f => React.createElement('div', { key: f, className: `file-list-item ${selectedFile === f ? 'selected' : ''}` },
                    React.createElement('span', { className: 'file-name' },
                      React.createElement('span', { className: 'file-icon' }, selectedFile === f ? '\u2705' : '\u{1F4C4}'),
                      f
                    ),
                    React.createElement('div', { className: 'file-actions' },
                      selectedFile === f
                        ? React.createElement('span', { style: { fontSize: '0.82rem', color: '#16a34a', fontWeight: '600' } }, '\u2713 \u05E0\u05D1\u05D7\u05E8')
                        : React.createElement('button', { className: 'select-btn', onClick: () => handleSelectFile({ target: { value: f } }) }, '\u05D1\u05D7\u05D9\u05E8\u05D4'),
                      React.createElement('button', { className: 'delete-btn', onClick: () => handleDeleteUpload(f) }, '\u05DE\u05D7\u05D9\u05E7\u05D4')
                    )
                  )),
                )
          ),
          // -- Upload New File Card --
          React.createElement('div', { className: 'upload-section-card' },
            React.createElement('h3', null, '\u05D4\u05E2\u05DC\u05D0\u05EA \u05DE\u05E1\u05DE\u05DA \u05D7\u05D3\u05E9'),
            React.createElement('div', { className: 'upload-area' },
              React.createElement('span', { className: 'upload-icon' }, '\u2B06'),
              React.createElement('label', { className: 'upload-btn' },
                '\u05D1\u05D7\u05E8\u05D5 \u05E7\u05D5\u05D1\u05E5',
                React.createElement('input', { type: 'file', onChange: handleFileUpload, accept: '.txt,.md,.doc,.docx' })
              ),
              React.createElement('p', { className: 'upload-hint' }, '\u05E4\u05D5\u05E8\u05DE\u05D8\u05D9\u05DD \u05E0\u05EA\u05DE\u05DB\u05D9\u05DD: DOCX, DOC, MD, TXT')
            )
          )
        );

      // ---- STEP 1: ANALYZE ----
      case 1:
        return React.createElement('div', { className: 'wizard-content-area', dir: 'rtl' },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' } },
            React.createElement('h3', { style: { margin: 0 } }, '\u05E0\u05D9\u05EA\u05D5\u05D7 \u05DE\u05E1\u05DE\u05DA'),
            selectedFile && React.createElement('span', { style: { color: '#64748b', fontSize: '0.88rem' } }, `(${selectedFile})`)
          ),
          isImproving && React.createElement('div', { style: { padding: '20px', backgroundColor: '#f1f5f9', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '20px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' } },
              React.createElement('div', { style: { width: '24px', height: '24px', borderRadius: '50%', border: '3px solid #cbd5e1', borderTopColor: '#3b82f6', animation: 'spin 1s linear infinite', flexShrink: 0 } }),
              React.createElement('span', { style: { fontWeight: '600', color: '#0f172a' }, dir: 'rtl' }, improvementStep)
            ),
            React.createElement('div', { style: { maxHeight: '200px', overflowY: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px' }, dir: 'rtl' },
              improvementLogs.map((log, i) => React.createElement('div', { key: i, style: { fontSize: '0.82rem', color: '#334155', padding: '4px 0', borderBottom: i === improvementLogs.length - 1 ? 'none' : '1px solid #e2e8f0' } }, log))
            )
          ),
          improvementTable.length > 0 && !isImproving && React.createElement('div', { dir: 'rtl', style: { marginBottom: '24px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' } },
              React.createElement('h4', { style: { margin: 0, color: '#0f172a', borderBottom: '2px solid #3b82f6', paddingBottom: '6px' } }, '\u05E1\u05D9\u05DB\u05D5\u05DE\u05D9\u05DD \u05DC\u05E4\u05D9 \u05E1\u05E2\u05D9\u05E3'),
              React.createElement('button', { className: 'collapsible-toggle', onClick: () => setSummaryCollapsed(!summaryCollapsed) },
                summaryCollapsed ? '\u05D4\u05E6\u05D2 \u25BC' : '\u05D4\u05E1\u05EA\u05E8 \u25B2'
              )
            ),
            !summaryCollapsed && React.createElement('div', { className: 'table-scroll-wrapper' },
              React.createElement('table', null,
                React.createElement('thead', null,
                  React.createElement('tr', null,
                    React.createElement('th', { style: { width: '20%' } }, '\u05E1\u05E2\u05D9\u05E3'),
                    React.createElement('th', { style: { width: '40%' } }, '\u05D8\u05E7\u05E1\u05D8 \u05DE\u05E7\u05D5\u05E8\u05D9'),
                    React.createElement('th', { style: { width: '40%' } }, '\u05E1\u05D9\u05DB\u05D5\u05DD')
                  )
                ),
                React.createElement('tbody', null,
                  improvementTable.map((row, i) => React.createElement('tr', { key: i, style: { backgroundColor: i % 2 === 0 ? '#fff' : '#f8fafc' } },
                    React.createElement('td', { style: { fontWeight: '500' } }, row.section_title),
                    React.createElement('td', null, React.createElement('div', { className: 'cell-md', dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(row.original_text || '')) } })),
                    React.createElement('td', null, React.createElement('div', { className: 'cell-md', dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(row.summary || '')) } }))
                  ))
                )
              )
            )
          ),
          editorContent && !isImproving && React.createElement('div', { style: { marginBottom: '20px' } },
            React.createElement('h4', { style: { marginBottom: '12px', color: '#0f172a', borderBottom: '2px solid #3b82f6', paddingBottom: '6px', display: 'inline-block' }, dir: 'rtl' }, '\u05E1\u05D9\u05DB\u05D5\u05DD \u05D4\u05DE\u05E1\u05DE\u05DA'),
            React.createElement('div', {
              className: 'rendered-md', dir: 'rtl',
              dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(editorContent)) },
              style: { border: '1px solid #cbd5e1', borderRadius: '8px', padding: '20px', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }
            })
          ),
          !editorContent && !isImproving && React.createElement('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '1.1rem', minHeight: '200px' } },
            '\u05DE\u05DB\u05D9\u05DF \u05D0\u05EA \u05D4\u05E0\u05D9\u05EA\u05D5\u05D7...'
          )
        );

      // ---- STEP 2: RESEARCH ----
      case 2:
        return React.createElement('div', { className: 'wizard-content-area', dir: 'rtl' },
          React.createElement('h3', { style: { marginBottom: '16px', textAlign: 'right' } }, '\u05DE\u05D7\u05E7\u05E8 \u05E9\u05D5\u05E7'),
          React.createElement('textarea', {
            dir: 'rtl',
            value: marketResearchGoal || projectGoal,
            onChange: e => setMarketResearchGoal(e.target.value),
            placeholder: '\u05EA\u05D0\u05E8\u05D5 \u05D0\u05EA \u05DE\u05D8\u05E8\u05EA \u05D4\u05DE\u05D7\u05E7\u05E8 \u05D1\u05E4\u05D9\u05E8\u05D5\u05D8. \u05DB\u05DC\u05DC\u05D5 \u05EA\u05E7\u05D5\u05E4\u05EA \u05D9\u05E2\u05D3, \u05E2\u05D3\u05D9\u05E4\u05D5\u05D9\u05D5\u05EA \u05D5\u05EA\u05D5\u05E6\u05D0\u05D5\u05EA \u05E6\u05E4\u05D5\u05D9\u05D5\u05EA.',
            style: { width: '100%', minHeight: '120px', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px', fontSize: '0.95rem', lineHeight: '1.5', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: '12px' }
          }),
          React.createElement('button', {
            onClick: handleStartMarketResearch,
            disabled: isMarketResearchLoading || !(marketResearchGoal || projectGoal || '').trim(),
            style: { padding: '10px 18px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', opacity: (isMarketResearchLoading || !(marketResearchGoal || projectGoal || '').trim()) ? 0.6 : 1 }
          }, isMarketResearchLoading ? '\u05DE\u05D1\u05E6\u05E2 \u05DE\u05D7\u05E7\u05E8...' : '\u05D4\u05EA\u05D7\u05DC\u05EA \u05DE\u05D7\u05E7\u05E8 \u05E9\u05D5\u05E7'),
          isMarketResearchLoading && React.createElement('div', { style: { marginTop: '16px', display: 'flex', alignItems: 'center', gap: '10px' } },
            React.createElement('div', { style: { width: '20px', height: '20px', borderRadius: '50%', border: '3px solid #cbd5e1', borderTopColor: '#10b981', animation: 'spin 1s linear infinite', flexShrink: 0 } }),
            React.createElement('span', { style: { color: '#475569' } }, loadingStatus || '\u05DE\u05D1\u05E6\u05E2 \u05DE\u05D7\u05E7\u05E8 \u05E9\u05D5\u05E7...')
          ),
          marketResearchError && React.createElement('div', { style: { marginTop: '12px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px', padding: '10px 12px' } }, marketResearchError),
          marketResearchMarkdown && React.createElement('div', { style: { marginTop: '20px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' } },
              React.createElement('h4', { style: { margin: 0, color: '#0f172a' } }, '\u05EA\u05D5\u05E6\u05D0\u05D5\u05EA \u05DE\u05D7\u05E7\u05E8 \u05E9\u05D5\u05E7'),
              React.createElement('button', { className: 'collapsible-toggle', onClick: () => setResearchCollapsed(!researchCollapsed) },
                researchCollapsed ? '\u05D4\u05E6\u05D2 \u25BC' : '\u05D4\u05E1\u05EA\u05E8 \u25B2'
              )
            ),
            !researchCollapsed && React.createElement('div', {
              className: 'rendered-md', dir: 'rtl',
              dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(marketResearchMarkdown)) },
              style: { border: '1px solid #cbd5e1', borderRadius: '8px', padding: '18px', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }
            })
          ),
          !marketResearchMarkdown && !isMarketResearchLoading && React.createElement('div', { style: { marginTop: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '1rem' } },
            '\u05D4\u05D6\u05D9\u05E0\u05D5 \u05D0\u05EA \u05DE\u05D8\u05E8\u05EA \u05D4\u05DE\u05D7\u05E7\u05E8 \u05D5\u05DC\u05D7\u05E6\u05D5 "\u05D4\u05EA\u05D7\u05DC\u05EA \u05DE\u05D7\u05E7\u05E8 \u05E9\u05D5\u05E7"'
          )
        );

      // ---- STEP 3: TOC ----
      case 3:
        return React.createElement('div', { className: 'wizard-content-area', dir: 'rtl' },
          React.createElement('h3', { style: { marginBottom: '16px', textAlign: 'right' } }, '\u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD'),
          React.createElement('div', { style: { marginBottom: '24px' } },
            React.createElement('h4', { style: { marginBottom: '10px', color: '#0f172a', borderBottom: '2px solid #10b981', paddingBottom: '6px', display: 'inline-block' } }, '\u05D4\u05DE\u05DC\u05E6\u05D5\u05EA'),
            !tocRecommendations && !isRecsLoading && React.createElement('div', { style: { marginBottom: '12px' } },
              React.createElement('button', {
                onClick: handleFetchRecommendations, disabled: isRecsLoading,
                style: { padding: '10px 18px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }
              }, '\u05E7\u05D1\u05DC\u05EA \u05D4\u05DE\u05DC\u05E6\u05D5\u05EA')
            ),
            isRecsLoading && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' } },
              React.createElement('div', { style: { width: '20px', height: '20px', borderRadius: '50%', border: '3px solid #cbd5e1', borderTopColor: '#10b981', animation: 'spin 1s linear infinite', flexShrink: 0 } }),
              React.createElement('span', { style: { color: '#475569' } }, loadingStatus || '\u05DE\u05D9\u05D9\u05E6\u05E8 \u05D4\u05DE\u05DC\u05E6\u05D5\u05EA...')
            ),
            recsError && React.createElement('div', { style: { border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' } }, recsError),
            tocRecommendations && React.createElement('div', {
              className: `rendered-md ${recsJustUpdated ? 'recs-content-fade' : ''}`,
              dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(tocRecommendations)) },
              style: { border: '1px solid #d1fae5', borderRadius: '8px', padding: '16px', backgroundColor: '#f0fdf4', marginBottom: '12px' }
            }),
            tocRecommendations && React.createElement('div', { style: { marginBottom: '16px' } },
              React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                React.createElement('input', {
                  type: 'text', value: recsChatInput,
                  onChange: e => setRecsChatInput(e.target.value),
                  onKeyDown: e => { if (e.key === 'Enter') handleRecsChatSend(); },
                  placeholder: '\u05E9\u05E4\u05E8\u05D5 \u05D0\u05EA \u05D4\u05D4\u05DE\u05DC\u05E6\u05D5\u05EA...',
                  disabled: isRecsChatLoading,
                  style: { flex: 1, padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.9rem', fontFamily: 'inherit' }
                }),
                React.createElement('button', {
                  onClick: handleRecsChatSend, disabled: isRecsChatLoading || !recsChatInput.trim(),
                  style: { padding: '8px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', opacity: (isRecsChatLoading || !recsChatInput.trim()) ? 0.6 : 1 }
                }, '\u05E9\u05DC\u05D7')
              )
            )
          ),
          React.createElement('div', { style: { marginBottom: '20px' } },
            React.createElement('button', {
              onClick: handleCreateNewTableOfContents, disabled: isTocLoading || !marketResearchMarkdown,
              style: { padding: '10px 18px', backgroundColor: '#0f766e', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.95rem', opacity: (isTocLoading || !marketResearchMarkdown) ? 0.6 : 1 }
            }, isTocLoading ? '\u05DE\u05D9\u05D9\u05E6\u05E8...' : '\u05D9\u05E6\u05D9\u05E8\u05EA \u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05D7\u05D3\u05E9'),
            isTocLoading && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' } },
              React.createElement('div', { style: { width: '20px', height: '20px', borderRadius: '50%', border: '3px solid #cbd5e1', borderTopColor: '#0f766e', animation: 'spin 1s linear infinite', flexShrink: 0 } }),
              React.createElement('span', { style: { color: '#475569' } }, loadingStatus || '\u05DE\u05D9\u05D9\u05E6\u05E8 \u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD...')
            ),
            tocError && React.createElement('div', { style: { marginTop: '12px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px', padding: '10px 12px' } }, tocError)
          ),
          tocModificationRow && renderTocDiffView()
        );

      // ---- STEP 4: SECTIONS ----
      case 4:
        return React.createElement('div', { className: 'wizard-content-area', dir: 'rtl' },
          React.createElement('h3', { style: { marginBottom: '16px', textAlign: 'right' } }, '\u05D9\u05E6\u05D9\u05E8\u05EA \u05E1\u05E2\u05D9\u05E4\u05D9\u05DD'),
          tocSectionRows.length > 0 && React.createElement('div', null,
            React.createElement('div', { className: 'table-scroll-wrapper' },
              React.createElement('table', null,
                React.createElement('thead', null,
                  React.createElement('tr', null,
                    React.createElement('th', { style: { width: '18%' } }, '\u05DB\u05D5\u05EA\u05E8\u05EA \u05E1\u05E2\u05D9\u05E3'),
                    React.createElement('th', { style: { width: '27%' } }, '\u05D8\u05E7\u05E1\u05D8 \u05DE\u05E7\u05D5\u05E8\u05D9'),
                    React.createElement('th', { style: { width: '27%' } }, '\u05D8\u05E7\u05E1\u05D8 \u05DE\u05E9\u05D5\u05E4\u05E8'),
                    React.createElement('th', { style: { width: '28%' } }, '\u05D4\u05E1\u05D1\u05E8')
                  )
                ),
                React.createElement('tbody', null,
                  tocSectionRows.map((row, i) => {
                    const isNew = isSectionNew(row.sectionTitle);
                    return React.createElement('tr', {
                      key: `sec-${i}`,
                      onClick: () => handleRowClick(i),
                      className: flashRowIndex === i ? 'section-flash' : '',
                      style: {
                        backgroundColor: selectedRowIndex === i ? '#dbeafe' : (i === currentSectionIndex && isSectionLoading ? '#fef9c3' : undefined),
                        cursor: 'pointer',
                        outline: selectedRowIndex === i ? '2px solid #3b82f6' : 'none', outlineOffset: '-2px'
                      }
                    },
                      React.createElement('td', { style: { fontWeight: '500' } },
                        row.sectionTitle,
                        isNew && React.createElement('span', {
                          style: { display: 'inline-block', marginRight: '6px', padding: '1px 6px', fontSize: '0.68rem', borderRadius: '10px', backgroundColor: '#dbeafe', color: '#1d4ed8', fontWeight: '600' }
                        }, '\u05D7\u05D3\u05E9')
                      ),
                      React.createElement('td', null,
                        row.originalText ? React.createElement('div', { className: 'cell-md', dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(row.originalText)) } }) : React.createElement('span', { style: { color: '#94a3b8', fontSize: '0.82rem' } }, isNew ? '\u05E1\u05E2\u05D9\u05E3 \u05D7\u05D3\u05E9' : '-')
                      ),
                      React.createElement('td', null,
                        i === currentSectionIndex && isSectionLoading ?
                          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', color: '#92400e', fontSize: '0.85rem' } },
                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                              React.createElement('div', { style: { width: '14px', height: '14px', borderRadius: '50%', border: '2px solid #fcd34d', borderTopColor: '#d97706', animation: 'spin 1s linear infinite', flexShrink: 0 } }),
                              '\u05DE\u05D9\u05D9\u05E6\u05E8...'
                            ),
                            loadingStatus && React.createElement('div', { style: { fontSize: '0.78rem', color: '#78716c' } }, loadingStatus)
                          )
                        : row.improvedText ?
                          (row.originalText ?
                            React.createElement('div', { className: 'cell-md', style: { lineHeight: '1.7' } }, renderWordDiff(row.originalText, row.improvedText))
                          : React.createElement('div', { className: 'cell-md', dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(row.improvedText)) } }))
                        : React.createElement('span', { style: { color: '#94a3b8', fontSize: '0.82rem' } }, '\u05DE\u05DE\u05EA\u05D9\u05DF...')
                      ),
                      React.createElement('td', null,
                        row.explanation ? React.createElement('div', { className: 'cell-md', dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(row.explanation)) } }) : '-'
                      )
                    );
                  })
                )
              )
            ),
            React.createElement('div', { style: { marginTop: '16px', textAlign: 'right' } },
              currentSectionIndex < tocSectionRows.length ?
                React.createElement('button', {
                  onClick: handleCreateNextSection, disabled: isSectionLoading,
                  style: { padding: '10px 18px', backgroundColor: '#7c3aed', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.95rem', opacity: isSectionLoading ? 0.6 : 1 }
                }, isSectionLoading ? '\u05D9\u05D5\u05E6\u05E8...' : `\u05D9\u05E6\u05D9\u05E8\u05EA: ${tocSectionRows[currentSectionIndex]?.sectionTitle || '\u05D4\u05D1\u05D0'}`)
              :
                React.createElement('div', { style: { color: '#16a34a', fontWeight: '600', fontSize: '0.95rem' } }, '\u2713 \u05DB\u05DC \u05D4\u05E1\u05E2\u05D9\u05E4\u05D9\u05DD \u05E0\u05D5\u05E6\u05E8\u05D5'),
              sectionError && React.createElement('div', { style: { marginTop: '10px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px', padding: '10px 12px' } }, sectionError)
            ),
            selectedRowIndex >= 0 && tocSectionRows[selectedRowIndex]?.originalText && tocSectionRows[selectedRowIndex]?.improvedText && React.createElement('div', { style: { marginTop: '20px', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#f8fafc' } },
              React.createElement('h5', { style: { margin: '0 0 10px', color: '#0f172a' } }, '\u05E9\u05D9\u05E0\u05D5\u05D9\u05D9\u05DD \u05D1\u05E8\u05DE\u05EA \u05DE\u05D9\u05DC\u05D4'),
              React.createElement('div', { style: { fontSize: '0.88rem', lineHeight: '1.7', direction: 'rtl' } },
                renderWordDiff(tocSectionRows[selectedRowIndex].originalText, tocSectionRows[selectedRowIndex].improvedText)
              )
            )
          ),
          tocSectionRows.length === 0 && React.createElement('div', { style: { textAlign: 'center', color: '#94a3b8', fontSize: '1rem', marginTop: '40px' } },
            '\u05E2\u05D1\u05E8\u05D5 \u05DC\u05E9\u05DC\u05D1 \u05EA\u05D5\u05DB\u05DF \u05D4\u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05DB\u05D3\u05D9 \u05DC\u05D9\u05E6\u05D5\u05E8 \u05EA\u05D5\u05DB\u05DF \u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD.'
          )
        );

      // ---- STEP 5: SAVE ----
      case 5:
        return React.createElement('div', { className: 'wizard-content-area', dir: 'rtl' },
          React.createElement('h3', { style: { marginBottom: '16px' } }, '\u05EA\u05E6\u05D5\u05D2\u05D4 \u05DE\u05E7\u05D3\u05D9\u05DE\u05D4 \u05D5\u05E9\u05DE\u05D9\u05E8\u05D4'),
          buildImprovedDocumentMarkdown() ? React.createElement('div', { style: { marginBottom: '24px' } },
            React.createElement('h4', { style: { marginBottom: '10px', color: '#0f172a', borderBottom: '2px solid #7c3aed', paddingBottom: '8px', display: 'inline-block' }, dir: 'rtl' }, '\u05EA\u05E6\u05D5\u05D2\u05D4 \u05DE\u05E7\u05D3\u05D9\u05DE\u05D4 \u05E9\u05DC \u05D4\u05DE\u05E1\u05DE\u05DA \u05D4\u05DE\u05E9\u05D5\u05E4\u05E8'),
            renderImprovedDocumentPreview()
          ) : React.createElement('div', { style: { textAlign: 'center', color: '#94a3b8', fontSize: '1rem', marginTop: '40px', marginBottom: '40px' } },
            '\u05E6\u05E8\u05D5 \u05E1\u05E2\u05D9\u05E4\u05D9\u05DD \u05DB\u05D3\u05D9 \u05DC\u05E6\u05E4\u05D5\u05EA \u05D1\u05EA\u05E6\u05D5\u05D2\u05D4 \u05DE\u05E7\u05D3\u05D9\u05DE\u05D4.'
          ),
          (editorContent || buildImprovedDocumentMarkdown()) && React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderTop: '1px solid #e2e8f0', marginTop: '10px' }
          },
            React.createElement('div', { style: { color: '#64748b', fontSize: '0.9rem' } },
              draftName ? `\u05E9\u05DE\u05D9\u05E8\u05D4 \u05D1\u05E9\u05DD: ${buildOutputFilename(draftName, outputFormat)}` : ''
            ),
            React.createElement('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
              React.createElement('input', {
                type: 'text', placeholder: '\u05E9\u05DD \u05D4\u05D8\u05D9\u05D5\u05D8\u05D4', value: draftName,
                onChange: e => setDraftName(e.target.value),
                style: { padding: '8px', minWidth: '220px', borderRadius: '4px', border: '1px solid #cbd5e1' }
              }),
              React.createElement('select', {
                value: outputFormat, onChange: e => setOutputFormat(e.target.value),
                style: { padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }
              },
                React.createElement('option', { value: 'pdf' }, 'PDF'),
                React.createElement('option', { value: 'docx' }, 'DOCX')
              ),
              React.createElement('button', {
                onClick: handleSaveVersion,
                disabled: !draftName || (!improvementTable.length && !buildImprovedDocumentMarkdown()),
                style: {
                  padding: '10px 25px', backgroundColor: '#3b82f6', color: 'white', border: 'none',
                  borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '1rem',
                  opacity: (!draftName || (!improvementTable.length && !buildImprovedDocumentMarkdown())) ? 0.5 : 1
                }
              }, '\u05E9\u05DE\u05D9\u05E8\u05EA \u05E7\u05D5\u05D1\u05E5')
            )
          ),
          React.createElement('div', { style: { marginTop: '30px' } },
            React.createElement('h4', null, '\u05D8\u05D9\u05D5\u05D8\u05D5\u05EA / \u05E7\u05D1\u05E6\u05D9\u05DD \u05E9\u05E0\u05D5\u05E6\u05E8\u05D5'),
            React.createElement('ul', { className: 'file-list' },
              createdFiles.length === 0 && React.createElement('li', { style: { backgroundColor: 'transparent', border: 'none', color: '#64748b' } }, '\u05D8\u05E8\u05DD \u05E0\u05D5\u05E6\u05E8\u05D5 \u05E7\u05D1\u05E6\u05D9\u05DD.'),
              createdFiles.map(f => React.createElement('li', { key: f, style: { display: 'flex', justifyContent: 'space-between' } },
                React.createElement('span', null, f),
                React.createElement('button', { onClick: () => handleDownloadFile(f), style: { background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontWeight: 'bold' } }, '\u05D4\u05D5\u05E8\u05D3\u05D4')
              ))
            )
          )
        );

      default:
        return null;
    }
  };

  // ===================== MAIN RENDER =====================
  return React.createElement(React.Fragment, null,
    React.createElement('style', null, `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`),

    React.createElement('div', { className: 'app-container' },
      renderChatPanel(),

      React.createElement('div', { className: 'right-panel', style: { flex: 1, minWidth: 0 } },
        renderWizardProgress(),

        React.createElement('div', { className: 'tab-content', style: { display: 'flex', flexDirection: 'column', transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center' } },
          React.createElement('div', { className: 'tab-pane', style: { display: 'flex', flexDirection: 'column', flex: 1 } },
            renderStepContent(),

            React.createElement('div', { className: 'wizard-nav' },
              React.createElement('button', {
                onClick: () => setWizardStep(Math.max(0, wizardStep - 1)),
                disabled: wizardStep === 0
              }, '\u05D7\u05D6\u05E8\u05D4'),
              React.createElement('span', { style: { fontSize: '0.85rem', color: '#64748b' } },
                `\u05E9\u05DC\u05D1 ${wizardStep + 1} \u05DE\u05EA\u05D5\u05DA ${WIZARD_STEPS.length}`
              ),
              wizardStep < WIZARD_STEPS.length - 1 ?
                React.createElement('button', {
                  className: 'primary',
                  onClick: () => { if (canGoToStep(wizardStep + 1)) setWizardStep(wizardStep + 1); },
                  disabled: !canGoToStep(wizardStep + 1)
                }, '\u05D4\u05D1\u05D0')
              :
                React.createElement('button', {
                  className: 'primary',
                  onClick: handleSaveVersion,
                  disabled: !draftName || (!improvementTable.length && !buildImprovedDocumentMarkdown())
                }, '\u05E9\u05DE\u05D9\u05E8\u05EA \u05DE\u05E1\u05DE\u05DA')
            )
          )
        )
      ),

      React.createElement('div', { className: 'zoom-controls' },
        React.createElement('button', { className: 'zoom-btn', onClick: () => setZoomLevel(Math.min(150, zoomLevel + 10)), title: '\u05D4\u05D2\u05D3\u05DC' }, '+'),
        React.createElement('button', { className: 'zoom-btn', onClick: () => setZoomLevel(100), title: '\u05D0\u05D9\u05E4\u05D5\u05E1', style: { fontSize: '0.7rem' } }, `${zoomLevel}%`),
        React.createElement('button', { className: 'zoom-btn', onClick: () => setZoomLevel(Math.max(60, zoomLevel - 10)), title: '\u05D4\u05E7\u05D8\u05DF' }, '-')
      )
    )
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
