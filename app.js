// SyncNotes - app.js
// firebase-config.js が正しく設定されていることを前提にしています。

const loginScreen = document.getElementById('login-screen');
const configScreen = document.getElementById('config-screen');
const appScreen = document.getElementById('app');
const googleSigninBtn = document.getElementById('google-signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const loginError = document.getElementById('login-error');
const emailAuthForm = document.getElementById('email-auth-form');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const emailSignupBtn = document.getElementById('email-signup-btn');
const biometricSigninBtn = document.getElementById('biometric-signin-btn');

const setPasswordBtn = document.getElementById('set-password-btn');
const passwordModal = document.getElementById('password-modal');
const passwordModalEmail = document.getElementById('password-modal-email');
const newPasswordInput = document.getElementById('new-password-input');
const newPasswordConfirmInput = document.getElementById('new-password-confirm-input');
const passwordModalError = document.getElementById('password-modal-error');
const passwordModalCancel = document.getElementById('password-modal-cancel');
const passwordModalSave = document.getElementById('password-modal-save');

const notesListEl = document.getElementById('notes-list');
const newNoteBtn = document.getElementById('new-note-btn');
const searchInput = document.getElementById('search-input');
const syncStatusEl = document.getElementById('sync-status');
const tagFilterEl = document.getElementById('tag-filter');

const titleInput = document.getElementById('note-title');
const contentInput = document.getElementById('note-content');
const contentView = document.getElementById('note-content-view');
const emptyState = document.getElementById('empty-state');
const editorMeta = document.getElementById('editor-meta');
const deleteBtn = document.getElementById('delete-note-btn');
const copyNoteBtn = document.getElementById('copy-note-btn');
const backBtn = document.getElementById('back-btn');
const noteTagsEl = document.getElementById('note-tags');
const appContainer = document.querySelector('.app-container');
const editorPaneEl = document.getElementById('editor-pane');
const fontSettingsBtn = document.getElementById('font-settings-btn');
const fontSettingsPanel = document.getElementById('font-settings-panel');
const fontSizeLabel = document.getElementById('font-size-label');
const fontSizeDecreaseBtn = document.getElementById('font-size-decrease');
const fontSizeIncreaseBtn = document.getElementById('font-size-increase');
const fontFamilySelect = document.getElementById('font-family-select');

let notes = [];
let currentNoteId = null;
let unsubscribeNotes = null;
let saveTimer = null;
let currentNotesRef = null;
let activeTagFilter = null;

// --- 文字サイズ・フォント設定 ---
// メモの内容ではなく端末ごとの表示設定なので、FirestoreではなくlocalStorageに保存する
(function initFontSettings() {
  const STORAGE_KEY = 'syncnotes-font-prefs';
  const SIZE_MIN = 13;
  const SIZE_MAX = 26;
  const SIZE_DEFAULT = 16;
  const FONT_FAMILIES = {
    default: '"Inter", "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
    serif: '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif',
    rounded: '"Zen Maru Gothic", "Hiragino Sans", sans-serif',
    mono: '"SF Mono", Menlo, Consolas, monospace',
  };

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { size: SIZE_DEFAULT, family: 'default' };
      const parsed = JSON.parse(raw);
      const size = Number(parsed.size);
      const family = FONT_FAMILIES[parsed.family] ? parsed.family : 'default';
      return {
        size: Number.isFinite(size) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, size)) : SIZE_DEFAULT,
        family,
      };
    } catch (e) {
      return { size: SIZE_DEFAULT, family: 'default' };
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) {
      // プライベートブラウズなど保存できない環境では無視する
    }
  }

  function applyPrefs(prefs) {
    document.documentElement.style.setProperty('--note-font-size', prefs.size + 'px');
    document.documentElement.style.setProperty('--note-font-family', FONT_FAMILIES[prefs.family]);
    if (fontSizeLabel) fontSizeLabel.textContent = prefs.size + 'px';
    if (fontFamilySelect) fontFamilySelect.value = prefs.family;
  }

  if (!fontSettingsBtn) return; // index.htmlが未更新の場合の保険

  let prefs = loadPrefs();
  applyPrefs(prefs);

  fontSettingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = fontSettingsPanel.style.display !== 'none';
    fontSettingsPanel.style.display = isOpen ? 'none' : 'block';
  });

  fontSettingsPanel.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('click', () => {
    fontSettingsPanel.style.display = 'none';
  });

  fontSizeDecreaseBtn.addEventListener('click', () => {
    prefs = { ...prefs, size: Math.max(SIZE_MIN, prefs.size - 1) };
    applyPrefs(prefs);
    savePrefs(prefs);
  });

  fontSizeIncreaseBtn.addEventListener('click', () => {
    prefs = { ...prefs, size: Math.min(SIZE_MAX, prefs.size + 1) };
    applyPrefs(prefs);
    savePrefs(prefs);
  });

  fontFamilySelect.addEventListener('change', () => {
    const family = FONT_FAMILIES[fontFamilySelect.value] ? fontFamilySelect.value : 'default';
    prefs = { ...prefs, family };
    applyPrefs(prefs);
    savePrefs(prefs);
  });
})();

// --- 設定チェック ---
if (typeof window.FIREBASE_CONFIG === 'undefined' ||
    !window.FIREBASE_CONFIG.apiKey ||
    window.FIREBASE_CONFIG.apiKey.includes('YOUR_')) {
  configScreen.style.display = 'flex';
} else {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {
    // 複数タブや非対応ブラウザでは失敗することがあるが致命的ではない
  });

  // ホーム画面アプリ(スタンドアロン)でもログイン状態を保持するため、
  // 明示的にローカル永続化を指定する
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
    console.warn('persistence設定に失敗しました', err);
  });

  const provider = new firebase.auth.GoogleAuthProvider();

  googleSigninBtn.addEventListener('click', () => {
    loginError.textContent = '';
    auth.signInWithPopup(provider).catch((err) => {
      // ポップアップがブロックされる環境(iOS Safari等)ではリダイレクトにフォールバック
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request') {
        auth.signInWithRedirect(provider);
      } else {
        loginError.textContent = 'ログインに失敗しました: ' + err.message;
      }
    });
  });

  // メール + パスワードでのログイン(ホーム画面アプリでも状態が保持されやすい)
  let isSignupMode = false;

  emailSignupBtn.addEventListener('click', () => {
    isSignupMode = true;
    loginError.textContent = '';
    document.getElementById('email-signin-btn').textContent = '新規登録する';
    emailSignupBtn.style.display = 'none';
  });

  // ブラウザのパスワード保存機能(iPhoneならFace ID/Touch IDで解錠)に
  // メール+パスワードを覚えてもらい、次回以降は生体認証だけでログインできるようにする
  function rememberCredential(email, password) {
    if (!('credentials' in navigator) || typeof window.PasswordCredential === 'undefined') return;
    try {
      const cred = new PasswordCredential({ id: email, password, name: email });
      navigator.credentials.store(cred).catch(() => {});
    } catch (e) {
      // 対応していないブラウザでは何もしない
    }
  }

  // 保存済みのパスワードでサインインを試みる共通処理
  function signInWithSavedCredential(mediation) {
    if (!('credentials' in navigator) || typeof window.PasswordCredential === 'undefined') {
      return Promise.resolve(false);
    }
    return navigator.credentials.get({ password: true, mediation }).then((cred) => {
      if (cred && cred.type === 'password' && cred.id && cred.password) {
        loginError.textContent = '';
        return auth.signInWithEmailAndPassword(cred.id, cred.password).then(() => true);
      }
      return false;
    }).catch(() => false);
  }

  if ('credentials' in navigator && typeof window.PasswordCredential !== 'undefined') {
    // 対応ブラウザではFace ID / Touch IDボタンを表示しておく
    biometricSigninBtn.style.display = 'block';
    // ページを開いた時点で、ユーザー操作なしに解錠できる場合は自動でログインする
    // (直前に許可した端末などで、ブラウザが確認なしに渡してよいと判断した場合のみ発生)
    signInWithSavedCredential('silent');
  }

  biometricSigninBtn.addEventListener('click', () => {
    loginError.textContent = '';
    signInWithSavedCredential('optional').then((ok) => {
      if (!ok) {
        loginError.textContent = '保存されたパスワードが見つかりませんでした。メールアドレスとパスワードでログインしてください。';
      }
    });
  });

  emailAuthForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || password.length < 6) {
      loginError.textContent = 'メールアドレスと6文字以上のパスワードを入力してください。';
      return;
    }
    const action = isSignupMode
      ? auth.createUserWithEmailAndPassword(email, password)
      : auth.signInWithEmailAndPassword(email, password);

    action.then(() => {
      rememberCredential(email, password);
    }).catch((err) => {
      if (err.code === 'auth/user-not-found') {
        loginError.textContent = 'アカウントが見つかりません。「はじめての方はこちら」から登録してください。';
      } else if (err.code === 'auth/email-already-in-use') {
        loginError.textContent = 'このメールアドレスは登録済みです。ログインしてください。';
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        loginError.textContent = 'パスワードが違います。';
      } else {
        loginError.textContent = 'エラー: ' + err.message;
      }
    });
  });

  signoutBtn.addEventListener('click', () => {
    if (unsubscribeNotes) unsubscribeNotes();
    auth.signOut();
  });

  // 既存アカウント(Googleログイン等)にパスワードを追加する
  function closePasswordModal() {
    passwordModal.style.display = 'none';
    newPasswordInput.value = '';
    newPasswordConfirmInput.value = '';
    passwordModalError.textContent = '';
  }

  setPasswordBtn.addEventListener('click', () => {
    if (!auth.currentUser) return;
    passwordModalError.textContent = '';
    newPasswordInput.value = '';
    newPasswordConfirmInput.value = '';
    passwordModalEmail.textContent = auth.currentUser.email || '';
    passwordModal.style.display = 'flex';
  });

  passwordModalCancel.addEventListener('click', () => {
    closePasswordModal();
  });

  passwordModalSave.addEventListener('click', () => {
    const pw1 = newPasswordInput.value;
    const pw2 = newPasswordConfirmInput.value;
    passwordModalError.textContent = '';

    if (pw1.length < 6) {
      passwordModalError.textContent = 'パスワードは6文字以上にしてください。';
      return;
    }
    if (pw1 !== pw2) {
      passwordModalError.textContent = '確認用パスワードが一致しません。';
      return;
    }
    const user = auth.currentUser;
    if (!user || !user.email) {
      passwordModalError.textContent = 'ユーザー情報を取得できませんでした。もう一度ログインしてください。';
      return;
    }

    passwordModalSave.disabled = true;
    passwordModalSave.textContent = '保存中…';

    const credential = firebase.auth.EmailAuthProvider.credential(user.email, pw1);
    user.linkWithCredential(credential).then(() => {
      passwordModalSave.disabled = false;
      passwordModalSave.textContent = '保存';
      rememberCredential(user.email, pw1);
      closePasswordModal();
      alert('パスワードを設定しました。今後は他の端末でも、このメールアドレスとパスワードでログインできます。');
    }).catch((err) => {
      if (err.code === 'auth/provider-already-linked' || err.code === 'auth/email-already-in-use' || err.code === 'auth/credential-already-in-use') {
        // 既にパスワードが設定済みの場合は、新しいパスワードに上書きする
        user.updatePassword(pw1).then(() => {
          passwordModalSave.disabled = false;
          passwordModalSave.textContent = '保存';
          rememberCredential(user.email, pw1);
          closePasswordModal();
          alert('パスワードを更新しました。今後は他の端末でも、このメールアドレスと新しいパスワードでログインできます。');
        }).catch((err2) => {
          passwordModalSave.disabled = false;
          passwordModalSave.textContent = '保存';
          if (err2.code === 'auth/requires-recent-login') {
            passwordModalError.textContent = 'セキュリティのため、一度ログアウトしてGoogleで再ログインしてから、もう一度お試しください。';
          } else if (err2.code === 'auth/weak-password') {
            passwordModalError.textContent = 'もっと複雑なパスワードにしてください。';
          } else {
            passwordModalError.textContent = 'エラー: ' + err2.message;
          }
        });
        return;
      }
      passwordModalSave.disabled = false;
      passwordModalSave.textContent = '保存';
      if (err.code === 'auth/requires-recent-login') {
        passwordModalError.textContent = 'セキュリティのため、もう一度ログインし直してから再度お試しください。';
      } else if (err.code === 'auth/weak-password') {
        passwordModalError.textContent = 'もっと複雑なパスワードにしてください。';
      } else {
        passwordModalError.textContent = 'エラー: ' + err.message;
      }
    });
  });

  auth.onAuthStateChanged((user) => {
    if (user) {
      loginScreen.style.display = 'none';
      appScreen.style.display = 'block';
      startSync(db, user.uid);
    } else {
      appScreen.style.display = 'none';
      loginScreen.style.display = 'flex';
    }
  });

  function startSync(db, uid) {
    const notesRef = db.collection('users').doc(uid).collection('notes');
    currentNotesRef = notesRef;

    unsubscribeNotes = notesRef.orderBy('updatedAt', 'desc').onSnapshot(
      (snapshot) => {
        notes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        syncStatusEl.textContent = '同期済み ✓';
        renderNotesList();
        if (currentNoteId) {
          const still = notes.find((n) => n.id === currentNoteId);
          if (!still) {
            currentNoteId = null;
            renderEditor();
          }
        }
        backfillAutoLinkTags(notesRef);
      },
      (err) => {
        console.error(err);
        syncStatusEl.textContent = '同期エラー';
      }
    );

    newNoteBtn.addEventListener('click', () => createNote(notesRef));
    deleteBtn.addEventListener('click', () => deleteCurrentNote(notesRef));
    backBtn.addEventListener('click', () => {
      appContainer.classList.remove('show-editor');
    });

    titleInput.addEventListener('input', () => scheduleSave(notesRef));
    contentInput.addEventListener('input', () => scheduleSave(notesRef));

    searchInput.addEventListener('input', renderNotesList);

    window._notesRef = notesRef; // for debugging convenience
  }

  function createNote(notesRef) {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    notesRef.add({
      title: '',
      content: '',
      tags: [],
      createdAt: now,
      updatedAt: now,
    }).then((docRef) => {
      currentNoteId = docRef.id;
      renderEditor();
      if (window.innerWidth <= 720) appContainer.classList.add('show-editor');
      titleInput.focus();
    });
  }

  function deleteCurrentNote(notesRef) {
    if (!currentNoteId) return;
    if (!confirm('このメモを削除しますか?')) return;
    notesRef.doc(currentNoteId).delete();
    currentNoteId = null;
    renderEditor();
    appContainer.classList.remove('show-editor');
  }

  // メモの本文にURLが含まれていたら自動で「リンク」タグを付け、
  // URLがなくなったら自動で外す(手動で付けたタグには影響しない)
  const AUTO_LINK_TAG = 'リンク';
  const AUTO_LINK_REGEX = /https?:\/\/\S+/;

  // 同期で読み込んだ時点で、まだ「リンク」タグが付いていない/外れていない
  // 既存メモを一括で補正する(機能追加前に作られたメモや、他端末での編集分もカバーする)
  let backfillInProgress = false;
  function backfillAutoLinkTags(notesRef) {
    if (backfillInProgress) return;
    const targets = notes.filter((note) => {
      const hasLink = AUTO_LINK_REGEX.test(note.content || '');
      const tags = note.tags || [];
      const hasTag = tags.includes(AUTO_LINK_TAG);
      return hasLink !== hasTag;
    });
    if (!targets.length) return;
    backfillInProgress = true;
    Promise.all(targets.map((note) => {
      const hasLink = AUTO_LINK_REGEX.test(note.content || '');
      const tags = note.tags || [];
      const newTags = hasLink
        ? [...tags, AUTO_LINK_TAG]
        : tags.filter((t) => t !== AUTO_LINK_TAG);
      note.tags = newTags;
      return notesRef.doc(note.id).update({ tags: newTags }).catch((err) => console.error(err));
    })).then(() => {
      backfillInProgress = false;
      renderNotesList();
      renderTagFilter();
      if (currentNoteId) {
        const current = notes.find((n) => n.id === currentNoteId);
        if (current) renderNoteTags(current);
      }
    });
  }

  function scheduleSave(notesRef) {
    if (!currentNoteId) return;
    clearTimeout(saveTimer);
    syncStatusEl.textContent = '保存中…';
    saveTimer = setTimeout(() => {
      const note = notes.find((n) => n.id === currentNoteId);
      const content = contentInput.value;
      const hasLink = AUTO_LINK_REGEX.test(content);
      let tags = (note && note.tags) || [];
      if (hasLink && !tags.includes(AUTO_LINK_TAG)) {
        tags = [...tags, AUTO_LINK_TAG];
      } else if (!hasLink && tags.includes(AUTO_LINK_TAG)) {
        tags = tags.filter((t) => t !== AUTO_LINK_TAG);
      }
      if (note) note.tags = tags;

      notesRef.doc(currentNoteId).update({
        title: titleInput.value,
        content,
        tags,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).then(() => {
        syncStatusEl.textContent = '同期済み ✓';
        if (note) renderNoteTags(note);
        renderTagFilter();
      }).catch((err) => {
        console.error(err);
        syncStatusEl.textContent = '保存エラー';
      });
    }, 500);
  }

  // --- タグ ---
  function normalizeTag(raw) {
    return raw.trim().replace(/^#/, '').replace(/\s+/g, ' ');
  }

  function addTag(rawTag) {
    const note = notes.find((n) => n.id === currentNoteId);
    if (!note || !currentNotesRef) return;
    const tag = normalizeTag(rawTag);
    if (!tag) return;
    const existing = note.tags || [];
    if (existing.includes(tag)) return;
    const tags = [...existing, tag];
    note.tags = tags;
    renderNoteTags(note, { focusInput: true });
    renderTagFilter();
    currentNotesRef.doc(currentNoteId).update({
      tags,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch((err) => console.error(err));
  }

  function removeTag(tagToRemove) {
    const note = notes.find((n) => n.id === currentNoteId);
    if (!note || !currentNotesRef) return;
    const tags = (note.tags || []).filter((t) => t !== tagToRemove);
    note.tags = tags;
    renderNoteTags(note, { focusInput: true });
    renderTagFilter();
    currentNotesRef.doc(currentNoteId).update({
      tags,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch((err) => console.error(err));
  }

  function renderNoteTags(note, opts) {
    const focusInput = !!(opts && opts.focusInput);
    noteTagsEl.innerHTML = '';
    (note.tags || []).forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag-pill';
      const label = document.createElement('span');
      label.className = 'tag-pill-text';
      label.textContent = tag;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tag-remove';
      removeBtn.title = 'タグを削除';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => removeTag(tag));
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      noteTagsEl.appendChild(chip);
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tag-input';
    input.placeholder = (note.tags || []).length ? 'タグを追加…' : '+ タグを追加(Enterで確定)';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (input.value.trim()) {
          addTag(input.value);
          input.value = '';
        }
      } else if (e.key === 'Backspace' && input.value === '' && (note.tags || []).length) {
        removeTag(note.tags[note.tags.length - 1]);
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) {
        addTag(input.value);
        input.value = '';
      }
    });
    noteTagsEl.appendChild(input);
    if (focusInput) input.focus();
  }

  function renderTagFilter() {
    const allTags = Array.from(new Set(notes.flatMap((n) => n.tags || []))).sort((a, b) => a.localeCompare(b, 'ja'));
    tagFilterEl.innerHTML = '';
    if (allTags.length === 0) {
      tagFilterEl.style.display = 'none';
      activeTagFilter = null;
      return;
    }
    if (activeTagFilter && !allTags.includes(activeTagFilter)) {
      activeTagFilter = null;
    }
    tagFilterEl.style.display = 'flex';

    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'tag-chip' + (activeTagFilter === null ? ' active' : '');
    allChip.textContent = 'すべて';
    allChip.addEventListener('click', () => {
      activeTagFilter = null;
      renderNotesList();
    });
    tagFilterEl.appendChild(allChip);

    allTags.forEach((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip' + (activeTagFilter === tag ? ' active' : '');
      chip.textContent = '#' + tag;
      chip.addEventListener('click', () => {
        activeTagFilter = activeTagFilter === tag ? null : tag;
        renderNotesList();
      });
      tagFilterEl.appendChild(chip);
    });
  }

  function selectNote(id) {
    currentNoteId = id;
    renderNotesList();
    renderEditor();
    if (window.innerWidth <= 720) appContainer.classList.add('show-editor');
  }

  function renderNotesList() {
    renderTagFilter();

    const query = searchInput.value.trim().toLowerCase();
    notesListEl.innerHTML = '';
    const filtered = notes.filter((n) => {
      if (activeTagFilter && !(n.tags || []).includes(activeTagFilter)) return false;
      if (!query) return true;
      return (n.title || '').toLowerCase().includes(query) ||
             (n.content || '').toLowerCase().includes(query);
    });

    filtered.forEach((note) => {
      const li = document.createElement('li');
      li.className = 'note-item' + (note.id === currentNoteId ? ' active' : '');
      const title = note.title && note.title.trim() ? note.title : '(無題)';
      const preview = (note.content || '').slice(0, 60).replace(/\n/g, ' ');
      const date = note.updatedAt && note.updatedAt.toDate
        ? note.updatedAt.toDate().toLocaleString('ja-JP')
        : '';
      li.innerHTML = `
        <div class="title"></div>
        <div class="preview"></div>
        <div class="date"></div>
      `;
      li.querySelector('.title').textContent = title;
      li.querySelector('.preview').textContent = preview;
      li.querySelector('.date').textContent = date;

      if (note.tags && note.tags.length) {
        const tagsRow = document.createElement('div');
        tagsRow.className = 'item-tags';
        note.tags.forEach((t) => {
          const pill = document.createElement('span');
          pill.className = 'item-tag';
          pill.textContent = t;
          tagsRow.appendChild(pill);
        });
        li.appendChild(tagsRow);
      }

      li.addEventListener('click', () => selectNote(note.id));
      notesListEl.appendChild(li);
    });
  }

  function renderEditor() {
    const note = notes.find((n) => n.id === currentNoteId);
    if (!note) {
      titleInput.style.display = 'none';
      contentInput.style.display = 'none';
      contentView.style.display = 'none';
      deleteBtn.style.display = 'none';
      copyNoteBtn.style.display = 'none';
      noteTagsEl.style.display = 'none';
      noteTagsEl.innerHTML = '';
      editorMeta.textContent = '';
      emptyState.classList.add('visible');
      return;
    }
    emptyState.classList.remove('visible');
    titleInput.style.display = 'block';
    deleteBtn.style.display = 'inline-block';
    copyNoteBtn.style.display = 'inline-flex';
    noteTagsEl.style.display = 'flex';
    titleInput.value = note.title || '';
    contentInput.value = note.content || '';
    renderNoteTags(note);
    editorMeta.textContent = note.updatedAt && note.updatedAt.toDate
      ? '最終更新: ' + note.updatedAt.toDate().toLocaleString('ja-JP')
      : '';
    showContentViewMode();
  }

  // --- URLを自動でリンク化する ---
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function linkify(text) {
    const escaped = escapeHtml(text || '');
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    return escaped.replace(urlRegex, (raw) => {
      let url = raw;
      let trail = '';
      const m = url.match(/[),.;:!?'"]+$/);
      if (m) {
        trail = m[0];
        url = url.slice(0, -trail.length);
      }
      if (!url) return raw;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trail}`;
    });
  }

  // メモ本文: 表示中はリンクをタップで開けるようにし、
  // 本文をタップすると編集モードに切り替わる
  function showContentViewMode() {
    contentInput.style.display = 'none';
    contentView.style.display = 'block';
    contentView.innerHTML = linkify(contentInput.value);
    contentView.setAttribute('data-placeholder', 'ここにメモを入力…');
  }

  function showContentEditMode(caretOffset) {
    contentView.style.display = 'none';
    contentInput.style.display = 'block';
    contentInput.focus();
    const len = contentInput.value.length;
    const pos = (typeof caretOffset === 'number' && caretOffset >= 0 && caretOffset <= len)
      ? caretOffset
      : len;
    contentInput.setSelectionRange(pos, pos);
  }

  // タップ/クリックした座標を、表示用div内の文字位置(本文中の何文字目か)に変換する。
  // これにより「本文をタップして編集モードに入る」ときに、タップした場所にカーソルを置ける。
  function getTextOffsetFromPoint(x, y) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    }
    if (!range || !contentView.contains(range.startContainer)) return null;
    const preRange = document.createRange();
    preRange.selectNodeContents(contentView);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  contentView.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') return; // リンクはそのまま開く
    if (!currentNoteId) return;
    const offset = getTextOffsetFromPoint(e.clientX, e.clientY);
    showContentEditMode(offset);
  });

  // --- 全文コピー ---
  // タイトルと本文をまとめてクリップボードにコピーする(歌詞や下書きをそのまま他アプリに貼り付けたいとき用)
  let copyResetTimer = null;
  function copyCurrentNote() {
    const note = notes.find((n) => n.id === currentNoteId);
    if (!note) return;
    const title = (note.title || '').trim();
    const content = (contentInput.value !== undefined ? contentInput.value : note.content) || '';
    const text = title ? `${title}\n\n${content}` : content;

    const showCopied = () => {
      clearTimeout(copyResetTimer);
      const original = copyNoteBtn.textContent;
      copyNoteBtn.textContent = '✅';
      copyResetTimer = setTimeout(() => {
        copyNoteBtn.textContent = original;
      }, 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied).catch(() => fallbackCopy(text, showCopied));
    } else {
      fallbackCopy(text, showCopied);
    }
  }

  function fallbackCopy(text, onSuccess) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      if (onSuccess) onSuccess();
    } catch (e) {
      console.error('コピーに失敗しました', e);
    }
  }

  copyNoteBtn.addEventListener('click', copyCurrentNote);

  contentInput.addEventListener('blur', () => {
    showContentViewMode();
    resetPageScroll();
  });
  titleInput.addEventListener('blur', resetPageScroll);

  // iOS Safariでは、キーボードが閉じたあとにページ全体がわずかにスクロール
  // されたまま戻らなくなることがある。html/bodyを固定した上で、入力欄から
  // フォーカスが外れたタイミングで念のためスクロール位置を強制的にリセットする。
  function resetPageScroll() {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  // 初期表示はメモ未選択状態
  renderEditor();
}

// --- PWA: Service Worker登録 ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('SW registration failed', err);
    });
  });
}
