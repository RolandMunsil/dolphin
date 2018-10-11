#include "AI.h"

#include "StringUtil.h"

#include "Common/Common.h"
#include "Common/CommonTypes.h"
#include "Common/Logging/ConsoleListener.h"
#include "Common/Logging/Log.h"
#include "Common/MsgHandler.h"

#include "Core/PowerPC/PowerPC.h"

template <typename... Args>
void AILog(const char* str, Args... args)
{
  std::string formatted = StringFromFormat(str, args...);
  LogListener*& logWindowListener = LogManager::GetInstance()->GetListeners()[LogListener::LOG_WINDOW_LISTENER];
  logWindowListener->Log(LogTypes::LOG_LEVELS::LINFO, formatted.c_str());
}

AI::AI()
{
  enabled = false;
  toggle_button_pressed_previous = false;

  did_q_learning_last_frame = false;

  real_distribution = std::uniform_real_distribution<float>(0.0, 1.0);
  action_index_distribution = std::uniform_int_distribution<u32>(0, (u32)Action::ACTIONS_COUNT - 1);

  chunk_to_actions_map = std::unordered_map<ChunkCoordinates, QState*, ChunkCoordinatesHasher>(
      INITIAL_MAP_BUCKET_COUNT);
}

bool AI::IsEnabled(GCPadStatus userInput)
{
  if (userInput.button & PAD_TRIGGER_Z)
  {
    if (!toggle_button_pressed_previous)
    {
      // toggle
      enabled = !enabled;
    }
    toggle_button_pressed_previous = true;
  }
  else
  {
    toggle_button_pressed_previous = false;
  }
  return enabled;
}

ChunkCoordinates AI::CalculateUserChunk()
{
  ChunkCoordinates userChunk = {
      (s16)std::floorf(player_info_retriever.PlayerVehicleX() / CHUNK_SIZE_METERS),
      (s16)std::floorf(player_info_retriever.PlayerVehicleY() / CHUNK_SIZE_METERS),
      (s16)std::floorf(player_info_retriever.PlayerVehicleZ() / CHUNK_SIZE_METERS)};

  return userChunk;
}

QState* AI::GetStateForChunk(ChunkCoordinates chunk)
{
  QState*& state_ref = chunk_to_actions_map[chunk];
  if (state_ref == nullptr)
  {
    state_ref = new QState;
  }
  return state_ref;
}

float AI::CalculateReward()
{
  // TODO: use these?
  // 0x584 - obstacle collision
  // 0x588	- track collision

  // u32 player_race_status_ptr = PowerPC::HostRead_U32(player_state_ptr - 0x20);
  // u32 checkpoint_number_also = PowerPC::HostRead_U32(player_race_status_ptr + 0x74);

  // u32 checkpoint_number = PowerPC::HostRead_U32(player_state_ptr + 0x1CC);
  // float frac_dist_to_next_checkpoint = PowerPC::HostRead_F32(player_state_ptr + 0x1D0);

  // TODO: use this or position diff?
  return player_info_retriever.PlayerSpeed() * (player_info_retriever.GoingTheWrongWay() ? -1 : 1);
}

Action AI::ChooseAction(QState* state, bool* action_chosen_randomly)
{
  float rand = real_distribution(generator);
  if (rand < EXPLORATION_RATE)
  {
    u32 actionIndex = action_index_distribution(generator);
    *action_chosen_randomly = true;
    return (Action)actionIndex;
  }
  else
  {
    *action_chosen_randomly = false;
    return state->BestAction();
  }
}

GCPadStatus AI::GenerateInputsFromAction(Action action)
{
  GCPadStatus pad = {};

  // Always be accelerating
  pad.button = PAD_BUTTON_A;
  pad.analogA = 0xFF;

  // Don't change the camera
  pad.substickX = GCPadStatus::C_STICK_CENTER_X;
  pad.substickY = GCPadStatus::C_STICK_CENTER_Y;

  // Don't tilt forward or back
  pad.stickY = GCPadStatus::MAIN_STICK_CENTER_Y;

  // Boost
  if (action == Action::BOOST_AND_FORWARD || action == Action::BOOST_AND_SOFT_TURN_RIGHT ||
      action == Action::BOOST_AND_SOFT_TURN_LEFT || action == Action::BOOST_AND_SHARP_TURN_RIGHT ||
      action == Action::BOOST_AND_SHARP_TURN_LEFT)
  {
    pad.button |= PAD_BUTTON_Y;
  }

  // Triggers
  if (action == Action::DRIFT_AND_SHARP_TURN_RIGHT || action == Action::DRIFT_AND_SHARP_TURN_LEFT)
  {
    pad.triggerLeft = 0xFF;
    pad.triggerRight = 0xFF;
  }
  else
  {
    pad.triggerLeft = 0;
    pad.triggerRight = 0;
  }

  // Control stick
  float stick_x_value;
  switch (action)
  {
  case Action::FORWARD:
  case Action::BOOST_AND_FORWARD:
  {
    stick_x_value = 0;
    break;
  }
  case Action::SOFT_TURN_RIGHT:
  case Action::BOOST_AND_SOFT_TURN_RIGHT:
  {
    stick_x_value = 0.5;
    break;
  }
  case Action::SOFT_TURN_LEFT:
  case Action::BOOST_AND_SOFT_TURN_LEFT:
  {
    stick_x_value = -0.5;
    break;
  }
  case Action::SHARP_TURN_RIGHT:
  case Action::BOOST_AND_SHARP_TURN_RIGHT:
  case Action::DRIFT_AND_SHARP_TURN_RIGHT:
  {
    stick_x_value = 1.0;
    break;
  }
  case Action::SHARP_TURN_LEFT:
  case Action::BOOST_AND_SHARP_TURN_LEFT:
  case Action::DRIFT_AND_SHARP_TURN_LEFT:
  {
    stick_x_value = -1.0;
    break;
  }
  default:
  {
    PanicAlert("Invalid action");
    stick_x_value = 0;
  }
  }

  pad.stickX = static_cast<u8>(GCPadStatus::MAIN_STICK_CENTER_X +
                               (stick_x_value * GCPadStatus::MAIN_STICK_RADIUS));

  return pad;
}

GCPadStatus AI::GetNextInput(const u32 pad_index)
{
  if (pad_index != 0)
  {
    AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    AILog("Skipping q-learning because pad index is %i", pad_index);
    return {};
  }

  if (!MSR.DR)
  {
    AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    AILog("Skipping q-learning because address translation is disabled");
    did_q_learning_last_frame = false;

    return {};
  }

  if (!player_info_retriever.UpdateInfo())
  {
    AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    AILog("Skipping q-learning because pointer to player state is null");
    did_q_learning_last_frame = false;

    return {};
  }

  u32 frame = player_info_retriever.CurrentFrame();
  if (frame == frame_at_last_input_request)
  {
    //AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    //AILog("Duplicate request for frame, returning cached input.");
    return cached_inputs;
  }

  // TODO: decrease epsilon
  // TODO: double-check that you're doing everything properly

  ChunkCoordinates userChunk = CalculateUserChunk();
  QState* state = GetStateForChunk(userChunk);

  float reward = NAN;
  float max_future_reward = NAN;
  float old_score = NAN;
  float new_score = NAN;
  if (did_q_learning_last_frame)
  {
    // Update q-value using bellman equation
    reward = CalculateReward();

    old_score = previous_state->ScoreForAction(previous_action);
    max_future_reward = state->BestScore();

    float learned_score = reward + (DISCOUNT_RATE * max_future_reward) - old_score;

    new_score = old_score + (LEARNING_RATE * learned_score);
    previous_state->SetActionScore(previous_action, new_score);
  }

  bool action_chosen_randomly;
  Action action_to_take = ChooseAction(state, &action_chosen_randomly);
  GCPadStatus inputs = GenerateInputsFromAction(action_to_take);


  // TODO: optimize logging
  AILog("============================================================");
  AILog("Frame: %i", player_info_retriever.CurrentFrame());
  AILog("State count: %i", chunk_to_actions_map.size());
  AILog("Pos:::: (%4f, %4f, %4f)", player_info_retriever.PlayerVehicleX(),
        player_info_retriever.PlayerVehicleY(), player_info_retriever.PlayerVehicleZ());
  AILog("Chunk:: (%5i, %5i, %5i)", userChunk.x, userChunk.y, userChunk.z);
  AILog("Speed:: %7.2f", player_info_retriever.PlayerSpeed());
  AILog("Scores: [%7.2f, %7.2f, %7.2f, %7.2f, %7.2f] (no boost)",
         state->ScoreForAction(Action::SHARP_TURN_LEFT),
         state->ScoreForAction(Action::SOFT_TURN_LEFT),
         state->ScoreForAction(Action::FORWARD),
         state->ScoreForAction(Action::SOFT_TURN_RIGHT),
         state->ScoreForAction(Action::SHARP_TURN_RIGHT));
  AILog("::::::: [%7.2f, %7.2f, %7.2f, %7.2f, %7.2f] (boost)",
         state->ScoreForAction(Action::BOOST_AND_SHARP_TURN_LEFT),
         state->ScoreForAction(Action::BOOST_AND_SOFT_TURN_LEFT),
         state->ScoreForAction(Action::BOOST_AND_FORWARD),
         state->ScoreForAction(Action::BOOST_AND_SOFT_TURN_RIGHT),
         state->ScoreForAction(Action::BOOST_AND_SHARP_TURN_RIGHT));
  AILog("::::::: [%7.2f,        ,        ,        , %7.2f] (drift)",
         state->ScoreForAction(Action::DRIFT_AND_SHARP_TURN_LEFT),
         state->ScoreForAction(Action::DRIFT_AND_SHARP_TURN_RIGHT));
  AILog("Action type:: %s", ACTION_NAMES.at(action_to_take).c_str());
  AILog("Way chosen::: %s", action_chosen_randomly ? "RANDOM" : "BEST");
  AILog("Action score: %f", state->ScoreForAction(action_to_take));
  if (did_q_learning_last_frame)
  {
    if (reward == NAN || max_future_reward == NAN || old_score == NAN || new_score == NAN)
    {
      PanicAlert("Score calculation not done even though it should have been!!!!");
      return {};
    }

    AILog("Reward for prev action: %f", reward);
    AILog("Max future reward:::::: %f", max_future_reward);
    AILog("Prev action old score:: %f", old_score);
    AILog("Prev action new score:: %f", new_score);
  }
  else
  {
    AILog("[");
    AILog("[ No learning done as AI was not");
    AILog("[ able to execute last frame. ");
    AILog("[");
  }

  // TODO: state saving

  did_q_learning_last_frame = true;
  previous_state = state;
  previous_action = action_to_take;

  frame_at_last_input_request = frame;
  cached_inputs = inputs;

  return inputs;
}

AI::~AI()
{
}
