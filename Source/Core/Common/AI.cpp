#include "AI.h"

#include <chrono>

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
  LogListener*& logWindowListener =
      LogManager::GetInstance()->GetListeners()[LogListener::LOG_WINDOW_LISTENER];
  logWindowListener->Log(LogTypes::LOG_LEVELS::LINFO, formatted.c_str());
}

template <typename... Args>
void LogToFileListener(LogListener*& fileListener, const char* str, Args... args)
{
  std::ostringstream oss;
  oss << str << std::endl;
  fileListener->Log(LogTypes::LOG_LEVELS::LINFO,
                    StringFromFormat(oss.str().c_str(), args...).c_str());
}

void AI::SaveStateToLog()
{
  std::chrono::time_point start_time = std::chrono::system_clock::now();

  LogListener*& fileListener =
      LogManager::GetInstance()->GetListeners()[LogListener::FILE_LISTENER];

  LogToFileListener(fileListener, "===================== BEGIN STATE =====================");
  LogToFileListener(fileListener, "___SUMMARY INFO___:");
  LogToFileListener(fileListener, "Frame Ct total learning: %i", learning_occured_frame_count);
  LogToFileListener(fileListener, "Frame Ct skip because can't access info: %i",
                    skip_learning_because_cant_access_info_frame_count);
  LogToFileListener(fileListener, "Frame Ct skip learning because death: %i",
                    skip_learning_because_crashing_frame_count);
  LogToFileListener(fileListener, "Frame Ct gen inputs but don't learn: %i",
                    generate_inputs_but_dont_learn_frame_count);
  LogToFileListener(fileListener, "Chunk count: %i", chunk_to_states_map.size());
  LogToFileListener(fileListener, "State count: %i", chunk_to_states_map.size() * 2);
  LogToFileListener(fileListener, "___Q TABLE___:");

  for (auto const& [chunk_coord, chunk_states] : chunk_to_states_map)
  {
    std::ostringstream right_way_values_string;
    for (u32 a = 0; a < (u32)Action::ACTIONS_COUNT; a++)
    {
      right_way_values_string << std::setprecision(10)
                              << chunk_states->going_right_way_state.ScoreForAction((Action)a)
                              << ",";
    }

    std::ostringstream wrong_way_values_string;
    for (u32 a = 0; a < (u32)Action::ACTIONS_COUNT; a++)
    {
      wrong_way_values_string << std::setprecision(10)
                              << chunk_states->going_wrong_way_state.ScoreForAction((Action)a)
                              << ",";
    }

    LogToFileListener(fileListener, "(%i,%i,%i)=R{%s}|W{%s}", chunk_coord.x, chunk_coord.y,
                      chunk_coord.z, right_way_values_string.str().c_str(),
                      wrong_way_values_string.str().c_str());
  }
  LogToFileListener(fileListener, "====================== END STATE ======================");

  std::chrono::time_point end_time = std::chrono::system_clock::now();

  std::ostringstream oss;
  oss << "Time to log: "
      << std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time).count()
      << " microseconds";

  LogToFileListener(fileListener, oss.str().c_str());
}

AI::AI()
{
  enabled = false;
  toggle_button_pressed_previous = false;

  did_q_learning_last_frame = false;

  real_distribution = std::uniform_real_distribution<float>(0.0, 1.0);
  action_index_distribution = std::uniform_int_distribution<u32>(0, (u32)Action::ACTIONS_COUNT - 1);

  chunk_to_states_map = std::unordered_map<ChunkCoordinates, ChunkStates*, ChunkCoordinatesHasher>(
      INITIAL_MAP_BUCKET_COUNT);

  learning_occured_frame_count = 0;
  skip_learning_because_cant_access_info_frame_count = 0;
  skip_learning_because_crashing_frame_count = 0;
  generate_inputs_but_dont_learn_frame_count = 0;
  debug_info_enabled = true;
}

bool AI::IsEnabled(GCPadStatus userInput)
{
  if (userInput.button & PAD_BUTTON_X)
  {
    if (!debug_info_enabled_button_pressed_previous)
    {
      // toggle
      debug_info_enabled = !debug_info_enabled;
    }
    debug_info_enabled_button_pressed_previous = true;
  }
  else
  {
    debug_info_enabled_button_pressed_previous = false;
  }

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

QState* AI::GetCurrentQState(ChunkCoordinates chunk)
{
  ChunkStates*& state_ref = chunk_to_states_map[chunk];
  if (state_ref == nullptr)
  {
    state_ref = new ChunkStates;
  }

  if (player_info_retriever.GoingTheWrongWay())
  {
    return &(state_ref->going_wrong_way_state);
  }
  else
  {
    return &(state_ref->going_right_way_state);
  }
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
  if (rand < CalculateExplorationRate())
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
  std::chrono::time_point calc_start_time = std::chrono::system_clock::now();

  if (pad_index != 0)
  {
    if (debug_info_enabled)
    {
      AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      AILog("Ignoring input request because pad index is %i", pad_index);
    }
    return {};
  }

  if (!MSR.DR)
  {
    AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    AILog("Skipping q-learning because address translation is disabled");
    did_q_learning_last_frame = false;
    skip_learning_because_cant_access_info_frame_count++;

    return {};
  }

  if (!player_info_retriever.UpdateInfo())
  {
    AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    AILog("Skipping q-learning because pointer to player state is null");
    did_q_learning_last_frame = false;
    skip_learning_because_cant_access_info_frame_count++;

    return {};
  }

  u32 frame = player_info_retriever.CurrentFrame();
  if (frame == frame_at_last_input_request)
  {
    // AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    // AILog("Duplicate request for frame, returning cached input.");
    return cached_inputs;
  }
  else
  {
    frame_at_last_input_request = frame;
  }

  if (player_info_retriever.CrashToRestoreFrameCount() > 0 ||
      player_info_retriever.DuringRestoreFrameCount() > 0)
  {
    if (debug_info_enabled)
    {
      AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      AILog("Skipping q-learning because car is currently crashing or being restored.");
    }
    did_q_learning_last_frame = false;
    skip_learning_because_crashing_frame_count++;

    cached_inputs = {};
    return {};
  }

  // TODO: vary rates over time
  // TODO: measure deaths
  // TODO: record lap times
  // TODO: log chunk sizes

  ChunkCoordinates userChunk = CalculateUserChunk();
  QState* state = GetCurrentQState(userChunk);

  float reward = NAN;
  float max_future_reward = NAN;
  float old_score = NAN;
  float new_score = NAN;
  if (did_q_learning_last_frame)
  {
    learning_occured_frame_count++;

    // Update q-value using bellman equation
    reward = CalculateReward();

    old_score = previous_state->ScoreForAction(previous_action);
    max_future_reward = state->BestScore();

    float learned_score = reward + (DISCOUNT_RATE * max_future_reward) - old_score;

    new_score = old_score + (LEARNING_RATE * learned_score);
    previous_state->SetActionScore(previous_action, new_score);
  }
  else
  {
    generate_inputs_but_dont_learn_frame_count++;
  }

  bool action_chosen_randomly;
  Action action_to_take = ChooseAction(state, &action_chosen_randomly);
  GCPadStatus inputs = GenerateInputsFromAction(action_to_take);

  if (debug_info_enabled)
  {
    std::chrono::time_point calc_end_time = std::chrono::system_clock::now();

    AILog("============================================================");
    AILog("Frame Ct total learning:                 %i", learning_occured_frame_count);
    AILog("Frame Ct skip because can't access info: %i",
          skip_learning_because_cant_access_info_frame_count);
    AILog("Frame Ct skip learning because death:    %i",
          skip_learning_because_crashing_frame_count);
    AILog("Frame Ct gen inputs but don't learn:     %i",
          generate_inputs_but_dont_learn_frame_count);
    AILog("Game reported frame:                     %i", player_info_retriever.CurrentFrame());
    AILog("Chunk count: %i", chunk_to_states_map.size());
    AILog("State count: %i", chunk_to_states_map.size() * 2);
    AILog("Pos:    (%4f, %4f, %4f)", player_info_retriever.PlayerVehicleX(),
          player_info_retriever.PlayerVehicleY(), player_info_retriever.PlayerVehicleZ());
    AILog("State:  (%3i, %3i, %3i) | %s way", userChunk.x, userChunk.y, userChunk.z,
          player_info_retriever.GoingTheWrongWay() ? "WRONG" : "RIGHT");
    AILog("Speed:  %7.2f", player_info_retriever.PlayerSpeed());
    AILog("Scores: [%7.2f, %7.2f, %7.2f, %7.2f, %7.2f] (no boost)",
          state->ScoreForAction(Action::SHARP_TURN_LEFT),
          state->ScoreForAction(Action::SOFT_TURN_LEFT), state->ScoreForAction(Action::FORWARD),
          state->ScoreForAction(Action::SOFT_TURN_RIGHT),
          state->ScoreForAction(Action::SHARP_TURN_RIGHT));
    AILog("        [%7.2f, %7.2f, %7.2f, %7.2f, %7.2f] (boost)",
          state->ScoreForAction(Action::BOOST_AND_SHARP_TURN_LEFT),
          state->ScoreForAction(Action::BOOST_AND_SOFT_TURN_LEFT),
          state->ScoreForAction(Action::BOOST_AND_FORWARD),
          state->ScoreForAction(Action::BOOST_AND_SOFT_TURN_RIGHT),
          state->ScoreForAction(Action::BOOST_AND_SHARP_TURN_RIGHT));
    AILog("        [%7.2f,        ,        ,        , %7.2f] (drift)",
          state->ScoreForAction(Action::DRIFT_AND_SHARP_TURN_LEFT),
          state->ScoreForAction(Action::DRIFT_AND_SHARP_TURN_RIGHT));
    AILog("Action type:  %s", ACTION_NAMES.at(action_to_take).c_str());
    AILog("Way chosen:   %s", action_chosen_randomly ? "RANDOM" : "BEST");
    AILog("Explore rate: %f", CalculateExplorationRate());
    AILog("Action score: %f", state->ScoreForAction(action_to_take));
    if (did_q_learning_last_frame)
    {
      if (reward == NAN || max_future_reward == NAN || old_score == NAN || new_score == NAN)
      {
        PanicAlert("Score calculation not done even though it should have been!!!!");
        return {};
      }

      AILog("Reward for prev action: %f", reward);
      AILog("Max future reward:      %f", max_future_reward);
      AILog("Prev action old score:  %f", old_score);
      AILog("Prev action new score:  %f", new_score);
    }
    else
    {
      AILog("[");
      AILog("[ No learning done as AI was not");
      AILog("[ able to execute last frame. ");
      AILog("[");
    }

    std::ostringstream oss;
    oss << "Time to calculate: "
         << std::chrono::duration_cast<std::chrono::microseconds>(calc_end_time - calc_start_time)
                .count()
         << " microseconds";
    AILog(oss.str().c_str());
  }

  if (learning_occured_frame_count % (SECONDS_BETWEEN_STATE_SAVES * 60) == 0)
  {
    AILog("Saved state to dolphin.log");
    SaveStateToLog();
  }

  did_q_learning_last_frame = true;
  previous_state = state;
  previous_action = action_to_take;

  cached_inputs = inputs;

  return inputs;
}

AI::~AI()
{
}
