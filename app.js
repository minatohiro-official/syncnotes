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
const backBtn = document.getElementById('back-btn');
const noteTagsEl = document.getElementById('note-tags');
const appContainer = document.querySelector('.app-container');

let notes = [];
let currentNoteId = null;
let unsubscribeNotes = null;
let saveTimer = null;
let currentNotesRef = null;
let activeTagFilter = null;

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

    action.catch((err) => {
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
      closePasswordModal();
      alert('パスワードを設定しました。今後は他の端末でも、このメールアドレスとパスワードでログインできます。');
    }).catch((err) => {
      if (err.code === 'auth/provider-already-linked' || err.code === 'auth/email-already-in-use' || err.code === 'auth/credential-already-in-use') {
        // 既にパスワードが設定済みの場合は、新しいパスワードに上書きする
        user.updatePassword(pw1).then(() => {
          passwordModalSave.disabled = false;
          passwordModalSave.textContent = '保存';
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

  function scheduleSave(notesRef) {
    if (!currentNoteId) return;
    clearTimeout(saveTimer);
    syncStatusEl.textContent = '保存中…';
    saveTimer = setTimeout(() => {
      notesRef.doc(currentNoteId).update({
        title: titleInput.value,
        content: contentInput.value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).then(() => {
        syncStatusEl.textContent = '同期済み ✓';
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
      noteTagsEl.style.display = 'none';
      noteTagsEl.innerHTML = '';
      editorMeta.textContent = '';
      emptyState.classList.add('visible');
      return;
    }
    emptyState.classList.remove('visible');
    titleInput.style.display = 'block';
    deleteBtn.style.display = 'inline-block';
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

  function showContentEditMode() {
    contentView.style.display = 'none';
    contentInput.style.display = 'block';
    contentInput.focus();
    const len = contentInput.value.length;
    contentInput.setSelectionRange(len, len);
  }

  contentView.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') return; // リンクはそのまま開く
    if (!currentNoteId) return;
    showContentEditMode();
  });

  contentInput.addEventListener('blur', () => {
    showContentViewMode();
  });

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
