import Delta from 'quill-delta';
import _ from 'lodash';

const snapshotStep = 400;

const updatePlayers = (players, params) => (
  players.map(player => (player.id === params.id
    ? { ...player, ...params }
    : player))
);

const updatePlayersGameResult = (players, firstPlayer, secondPlayer) => (
  players.map(player => ((player.id === firstPlayer.id)
    ? { ...player, ...firstPlayer }
    : { ...player, ...secondPlayer }))
);

export const getText = (text, { delta: d }) => {
  const textDelta = new Delta().insert(text);
  const delta = new Delta(d);
  const finalDelta = textDelta.compose(delta);
  return finalDelta.ops[0].insert;
};

const collectFinalRecord = (acc, record) => {
  const { players } = acc;
  switch (record.type) {
    case 'editor_text': {
      const player = _.find(players, { id: record.userId });
      const editorText = getText(player.editorText, record.diff);
      const newPlayers = updatePlayers(players, {
        id: record.userId,
        editorText,
        editorLang: record.editorLang,
      });

      return { ...acc, players: newPlayers };
    }
    case 'result_check': {
      const newPlayers = updatePlayers(players, {
        id: record.id,
        result: record.result,
        output: record.output,
      });

      return { ...acc, players: newPlayers };
    }
    case 'chat_message':
    case 'join_chat':
    case 'leave_chat': {
      return { ...acc, chat: record.chat };
    }
    default: {
      return acc;
    }
  }
};

const createFinalRecord = (index, record, params) => {
  if (index % snapshotStep === 0) {
    return { ...record, ...params };
  }

  return record;
};

const reduceOriginalRecords = (acc, record, index) => {
  const { players: playersState, records, chat: chatState } = acc;
  const { messages, users } = chatState;
  const { editorText, editorLang } = _.find(playersState, { id: record.id });

  const { type } = record;

  if (type === 'editor_text') {
    const { diff } = record;

    const newEditorText = getText(editorText, diff);
    const newPlayers = updatePlayers(
      playersState,
      { id: record.id, editorText: newEditorText, editorLang },
    );
    const data = {
      type,
      userId: record.id,
      editorLang,
      diff: record.diff,
    };
    const newRecord = createFinalRecord(index, data, {
      players: newPlayers,
      chat: chatState,
    });

    return { ...acc, players: newPlayers, records: [...records, newRecord] };
  }

  if (type === 'editor_lang') {
    const lang = record.diff.nextLang;
    const newPlayers = updatePlayers(playersState, { id: record.id, editorLang: lang });
    const newRecord = createFinalRecord(index, record, {
      players: playersState,
      chat: chatState,
    });
    return { ...acc, players: newPlayers, records: [...records, newRecord] };
  }

  if (type === 'result_check') {
    const { result, output } = record;

    const newPlayers = updatePlayers(playersState, { id: record.id, result, output });
    const data = {
      type,
      userId: record.id,
      result,
      output,
    };
    const newRecord = createFinalRecord(index, data, {
      players: newPlayers,
      chat: chatState,
    });

    return { ...acc, players: newPlayers, records: [...records, newRecord] };
  }

  if (type === 'chat_message') {
    const message = {
      id: record.id,
      user: record.name,
      message: record.message,
    };

    const newMessages = [...messages, message];
    const newChatState = { users, messages: newMessages };
    const data = {
      type,
      chat: newChatState,
    };
    const newRecord = createFinalRecord(index, data, { players: playersState });

    return { ...acc, chat: newChatState, records: [...records, newRecord] };
  }

  if (type === 'join_chat') {
    const user = {
      id: record.id,
      name: record.name,
    };

    const newChatUsers = [...users, user];
    const newChatState = { users: newChatUsers, messages };
    const data = {
      type,
      chat: newChatState,
    };
    const newRecord = createFinalRecord(index, data, { players: playersState });

    return { ...acc, chat: newChatState, records: [...records, newRecord] };
  }

  if (type === 'leave_chat') {
    const newUsers = users.filter(user => user.id === record.id);
    const newChatState = { users: newUsers, messages };
    const data = {
      type,
      chat: newChatState,
    };
    const newRecord = createFinalRecord(index, data, { players: playersState });

    return { ...acc, chat: newChatState, records: [...records, newRecord] };
  }

  if (type === 'give_up') {
    const newPlayers = updatePlayersGameResult(
      playersState,
      { id: record.id, gameResult: 'gave_up' },
      { gameResult: 'won' },
    );
    const data = { type: record.type };
    const newRecord = createFinalRecord(index, data, {
      players: newPlayers,
      chat: chatState,
    });

    return { ...acc, players: newPlayers, records: [...records, newRecord] };
  }

  if (type === 'check_complete') {
    const newPlayers = updatePlayersGameResult(
      playersState,
      { id: record.id, gameResult: 'won' },
      { gameResult: 'lost' },
    );
    const data = { type: record.type };
    const newRecord = createFinalRecord(index, data, {
      players: newPlayers,
      chat: chatState,
    });

    return { ...acc, players: newPlayers, records: [...records, newRecord] };
  }

  const newRecord = createFinalRecord(index, record, {
    players: playersState,
    chat: chatState,
  });

  return { ...acc, records: [...records, newRecord] };
};

export const getFinalState = ({ recordId, records, gameInitialState }) => {
  const closestFullRecordId = Math.floor(recordId / snapshotStep) * snapshotStep;
  const closestFullRecord = records[closestFullRecordId];

  const finalRecord = records
    .slice(closestFullRecordId + 1, recordId)
    .reduce(collectFinalRecord, closestFullRecord);

  const nextRecordId = recordId !== records.length ? recordId : recordId - 1;
  return nextRecordId === 0 ? gameInitialState : { ...finalRecord, nextRecordId };
};

export const resolveDiffs = playbook => {
  const [initPlayerOne, initPlayerTwo, ...restRecords] = playbook.records;
  const initGameState = {
    players: [initPlayerOne, initPlayerTwo],
    records: [],
    chat: {
      messages: [],
      users: [],
    },
  };

  const { records: newRecords, chat, players } = restRecords
    .reduce(reduceOriginalRecords, initGameState);

  const finalPlaybook = {
    ...playbook, initRecords: [initPlayerOne, initPlayerTwo], records: newRecords, chat, players,
  };

  return finalPlaybook;
};

export default resolveDiffs;
